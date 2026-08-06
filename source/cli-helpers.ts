import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";

import { type LintFormatTooling, lintFormatToolingSchema } from "./lint-format-tooling.js";
import { normalizeGitHubUrl, stripPackageScope } from "./name-helpers.js";
import type { Bundler, LicenseName, PackageManager } from "./templates/scaffold-config.js";
import { bundlerSchema, licenseNameSchema, packageManagerSchema } from "./templates/state.js";

export { normalizeGitHubUrl } from "./name-helpers.js";

const execFileAsync = promisify(execFile);

export interface CliArguments {
  author?: string;
  backup?: boolean;
  bundler?: Bundler;
  cli?: boolean;
  codecov?: boolean;
  communityFiles?: boolean;
  description?: string;
  directoryArgument?: string;
  dryRun: boolean;
  force: boolean;
  help: boolean;
  jsr?: boolean;
  license?: LicenseName;
  lintFormatTooling?: LintFormatTooling;
  packageManager?: PackageManager;
  projectName?: string;
  repoUrl?: string;
  securityWorkflows?: boolean;
  command: CliCommand;
  configAction?: ConfigAction;
  configKey?: string;
  configPath?: string;
  configValue?: string;
  saveDefaults: boolean;
  skipGit: boolean;
  skipInstall: boolean;
  version: boolean;
  workspace?: boolean;
  yes: boolean;
  zod?: boolean;
}

export interface DetectedDefaults {
  author: string;
  githubRepoUrl: string;
  projectName: string;
}

export type CliCommand = "config" | "scaffold" | "update";
export type ConfigAction = "get" | "path" | "set" | "unset";

const configActions = new Set<ConfigAction>(["get", "path", "set", "unset"]);

export type WarningSink = (message: string) => void;
type CliBooleanFlag =
  | "dryRun"
  | "force"
  | "help"
  | "saveDefaults"
  | "skipGit"
  | "skipInstall"
  | "version"
  | "yes";
type CliToggleFlag =
  | "backup"
  | "cli"
  | "codecov"
  | "communityFiles"
  | "jsr"
  | "securityWorkflows"
  | "workspace"
  | "zod";

interface GitReaders {
  readGitConfigValue(key: string): Promise<string>;
  readGitRemoteOrigin(): Promise<string>;
}

const cliFlagAliases = new Map<string, CliBooleanFlag>([
  ["--dry-run", "dryRun"],
  ["--force", "force"],
  ["--help", "help"],
  ["--save-defaults", "saveDefaults"],
  ["--skip-git", "skipGit"],
  ["--skip-install", "skipInstall"],
  ["--version", "version"],
  ["--yes", "yes"],
  ["-h", "help"],
  ["-v", "version"],
  ["-y", "yes"],
]);

const cliToggleFlags = new Map<string, { key: CliToggleFlag; value: boolean }>([
  ["--cli", { key: "cli", value: true }],
  ["--no-backup", { key: "backup", value: false }],
  ["--codecov", { key: "codecov", value: true }],
  ["--community-files", { key: "communityFiles", value: true }],
  ["--jsr", { key: "jsr", value: true }],
  ["--no-cli", { key: "cli", value: false }],
  ["--no-codecov", { key: "codecov", value: false }],
  ["--no-community-files", { key: "communityFiles", value: false }],
  ["--no-jsr", { key: "jsr", value: false }],
  ["--no-security-workflows", { key: "securityWorkflows", value: false }],
  ["--no-zod", { key: "zod", value: false }],
  ["--no-workspace", { key: "workspace", value: false }],
  ["--security-workflows", { key: "securityWorkflows", value: true }],
  ["--workspace", { key: "workspace", value: true }],
  ["--zod", { key: "zod", value: true }],
]);

/**
 * Boolean flags that `update` accepts. Toggle and value options are always
 * scaffold-only, so a new option added to the parsing maps is rejected for
 * `update` unless it is explicitly allowed here.
 */
const updateCompatibleFlags = new Set<CliBooleanFlag>([
  "dryRun",
  "force",
  "help",
  "version",
  "yes",
]);

/**
 * Value and toggle options each non-scaffold command additionally accepts.
 * Everything else in the parsing maps stays scaffold-only, so a newly added
 * option is rejected for these commands until it is listed here deliberately.
 */
const commandCompatibleOptions = {
  config: new Set(["--config"]),
  update: new Set(["--no-backup"]),
} satisfies Record<Exclude<CliCommand, "scaffold">, ReadonlySet<string>>;

interface CliValueOptionConfig {
  apply(parsed: CliArguments, value: string, optionName: string): void;
}

const createEnumValueParser =
  <T extends string>(options: readonly T[]) =>
  (value: string, optionName: string): T => {
    const match = options.find((option) => option === value);
    if (match === undefined) {
      throw new Error(
        `Invalid ${optionName} value: ${value}. Expected one of: ${options.join(", ")}`,
      );
    }

    return match;
  };

const parseBundlerValue = createEnumValueParser(bundlerSchema.options);
const parseLicenseValue = createEnumValueParser(licenseNameSchema.options);
const parseLintFormatValue = createEnumValueParser(lintFormatToolingSchema.options);
const parsePackageManagerValue = createEnumValueParser(packageManagerSchema.options);

const cliValueOptions = new Map<string, CliValueOptionConfig>([
  [
    "--author",
    {
      apply: (parsed, value) => {
        parsed.author = value;
      },
    },
  ],
  [
    "--bundler",
    {
      apply: (parsed, value, optionName) => {
        parsed.bundler = parseBundlerValue(value, optionName);
      },
    },
  ],
  [
    "--config",
    {
      apply: (parsed, value) => {
        parsed.configPath = value;
      },
    },
  ],
  [
    "--description",
    {
      apply: (parsed, value) => {
        parsed.description = value;
      },
    },
  ],
  [
    "--license",
    {
      apply: (parsed, value, optionName) => {
        parsed.license = parseLicenseValue(value, optionName);
      },
    },
  ],
  [
    "--lint-format",
    {
      apply: (parsed, value, optionName) => {
        parsed.lintFormatTooling = parseLintFormatValue(value, optionName);
      },
    },
  ],
  [
    "--name",
    {
      apply: (parsed, value) => {
        parsed.projectName = value;
      },
    },
  ],
  [
    "--package-manager",
    {
      apply: (parsed, value, optionName) => {
        parsed.packageManager = parsePackageManagerValue(value, optionName);
      },
    },
  ],
  [
    "--repo-url",
    {
      apply: (parsed, value) => {
        parsed.repoUrl = normalizeGitHubUrl(value);
      },
    },
  ],
]);

/**
 * Every option name the parser accepts, derived from the parsing maps so a new
 * option cannot be added without `--help` coverage. `cli-output` tests assert
 * each name (or its collapsed `--[no-]name` form) appears in the help text.
 */
export const cliOptionNames: readonly string[] = [
  ...cliFlagAliases.keys(),
  ...cliToggleFlags.keys(),
  ...cliValueOptions.keys(),
];

export const parseCliArguments = (args: string[]): CliArguments => {
  const parsed: CliArguments = {
    command: "scaffold",
    dryRun: false,
    force: false,
    help: false,
    saveDefaults: false,
    skipGit: false,
    skipInstall: false,
    version: false,
    yes: false,
  };
  const positionals: string[] = [];
  const scaffoldOnlyOptions: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? "";

    const toggle = cliToggleFlags.get(argument);
    if (toggle) {
      parsed[toggle.key] = toggle.value;
      scaffoldOnlyOptions.push(argument);
      continue;
    }

    const consumed = applyValueOption(parsed, args, index, argument);
    if (consumed > 0) {
      const equalsIndex = argument.indexOf("=");
      scaffoldOnlyOptions.push(equalsIndex >= 0 ? argument.slice(0, equalsIndex) : argument);
      index += consumed - 1;
      continue;
    }

    const flag = cliFlagAliases.get(argument);
    if (flag) {
      parsed[flag] = true;
      if (!updateCompatibleFlags.has(flag)) {
        scaffoldOnlyOptions.push(argument);
      }
      continue;
    }

    if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    }

    positionals.push(argument);
  }

  applyPositionals(parsed, positionals);
  validateUpdateArguments(parsed, scaffoldOnlyOptions);

  return parsed;
};

const validateUpdateArguments = (parsed: CliArguments, scaffoldOnlyOptions: string[]): void => {
  if (parsed.command === "scaffold") {
    return;
  }

  const allowedOptions = commandCompatibleOptions[parsed.command];
  const [rejectedOption] = scaffoldOnlyOptions.filter((option) => !allowedOptions.has(option));
  if (rejectedOption !== undefined) {
    throw new Error(`Option ${rejectedOption} cannot be used with ${parsed.command}.`);
  }
};

const applyPositionals = (parsed: CliArguments, positionals: string[]): void => {
  let remaining = positionals;

  if (remaining[0] === "update") {
    parsed.command = "update";
    remaining = remaining.slice(1);
  } else if (remaining[0] === "config") {
    parsed.command = "config";
    applyConfigPositionals(parsed, remaining.slice(1));
    return;
  }

  const [directoryArgument, ...extra] = remaining;
  if (extra.length > 0) {
    throw new Error(`Unexpected extra argument: ${extra[0]}`);
  }

  if (directoryArgument !== undefined) {
    parsed.directoryArgument = directoryArgument;
  }
};

const isConfigAction = (value: string): value is ConfigAction =>
  configActions.has(value as ConfigAction);

const applyConfigPositionals = (parsed: CliArguments, positionals: string[]): void => {
  const [action, key, value, ...extra] = positionals;

  if (action === undefined) {
    throw new Error(
      `Missing config action. Expected one of: ${[...configActions].sort().join(", ")}`,
    );
  }

  if (!isConfigAction(action)) {
    throw new Error(
      `Unknown config action: ${action}. Expected one of: ${[...configActions].sort().join(", ")}`,
    );
  }

  if (extra.length > 0) {
    throw new Error(`Unexpected extra argument: ${extra[0]}`);
  }

  parsed.configAction = action;

  if ((action === "set" || action === "unset") && key === undefined) {
    throw new Error(`config ${action} requires a key.`);
  }

  if (action === "set" && value === undefined) {
    throw new Error("config set requires a value.");
  }

  if (action === "path" && key !== undefined) {
    throw new Error(`Unexpected extra argument: ${key}`);
  }

  if (key !== undefined) {
    parsed.configKey = key;
  }

  if (value !== undefined) {
    parsed.configValue = value;
  }
};

/**
 * Handles `--option value` and `--option=value` forms. Returns how many
 * arguments were consumed, or 0 when the argument is not a value option.
 */
const applyValueOption = (
  parsed: CliArguments,
  args: string[],
  index: number,
  argument: string,
): number => {
  const equalsIndex = argument.indexOf("=");
  const optionName = equalsIndex >= 0 ? argument.slice(0, equalsIndex) : argument;
  const option = cliValueOptions.get(optionName);
  if (!option) {
    return 0;
  }

  if (equalsIndex >= 0) {
    option.apply(
      parsed,
      requireOptionValue(argument.slice(equalsIndex + 1), optionName),
      optionName,
    );
    return 1;
  }

  option.apply(parsed, requireOptionValue(args[index + 1], optionName), optionName);
  return 2;
};

const requireOptionValue = (value: string | undefined, optionName: string): string => {
  if (value === undefined || value.length === 0 || value.startsWith("-")) {
    throw new Error(`Missing value for ${optionName}.`);
  }

  return value;
};

export const deriveDirectoryName = (projectName: string): string => stripPackageScope(projectName);

export const detectDefaults = async (
  directoryArgument: string | undefined,
  options: {
    gitReaders?: GitReaders;
    warn?: WarningSink;
  } = {},
): Promise<DetectedDefaults> => {
  const defaultProjectName = directoryArgument ? basename(directoryArgument) : "my-lib";
  const gitReaders = options.gitReaders ?? defaultGitReaders(options.warn ?? noop);
  const [userName, userEmail, remoteUrl] = await Promise.all([
    gitReaders.readGitConfigValue("user.name"),
    gitReaders.readGitConfigValue("user.email"),
    gitReaders.readGitRemoteOrigin(),
  ]);
  const author = [userName, userEmail ? `<${userEmail}>` : ""].filter(Boolean).join(" ").trim();

  return {
    author,
    githubRepoUrl: normalizeGitHubUrl(remoteUrl),
    projectName: defaultProjectName,
  };
};

const defaultGitReaders = (warn: WarningSink): GitReaders => ({
  readGitConfigValue: async (key) => {
    try {
      const { stdout } = await execFileAsync("git", ["config", key]);
      return stdout.trim();
    } catch {
      warn(`Could not read git config ${key}; using a blank default.`);
      return "";
    }
  },
  readGitRemoteOrigin: async () => {
    try {
      const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"]);
      return stdout.trim();
    } catch {
      warn("Could not read git remote origin; using a blank GitHub repo default.");
      return "";
    }
  },
});

const noop: WarningSink = () => undefined;
