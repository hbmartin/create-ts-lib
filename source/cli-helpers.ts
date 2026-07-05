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
  bundler?: Bundler;
  cli?: boolean;
  codecov?: boolean;
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
  skipGit: boolean;
  skipInstall: boolean;
  update: boolean;
  version: boolean;
  yes: boolean;
  zod?: boolean;
}

export interface DetectedDefaults {
  author: string;
  githubRepoUrl: string;
  projectName: string;
}

export type WarningSink = (message: string) => void;
type CliBooleanFlag = "dryRun" | "force" | "help" | "skipGit" | "skipInstall" | "version" | "yes";
type CliToggleFlag = "cli" | "codecov" | "jsr" | "securityWorkflows" | "zod";

interface GitReaders {
  readGitConfigValue(key: string): Promise<string>;
  readGitRemoteOrigin(): Promise<string>;
}

const cliFlagAliases = new Map<string, CliBooleanFlag>([
  ["--dry-run", "dryRun"],
  ["--force", "force"],
  ["--help", "help"],
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
  ["--codecov", { key: "codecov", value: true }],
  ["--jsr", { key: "jsr", value: true }],
  ["--no-cli", { key: "cli", value: false }],
  ["--no-codecov", { key: "codecov", value: false }],
  ["--no-jsr", { key: "jsr", value: false }],
  ["--no-security-workflows", { key: "securityWorkflows", value: false }],
  ["--no-zod", { key: "zod", value: false }],
  ["--security-workflows", { key: "securityWorkflows", value: true }],
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

export const parseCliArguments = (args: string[]): CliArguments => {
  const parsed: CliArguments = {
    dryRun: false,
    force: false,
    help: false,
    skipGit: false,
    skipInstall: false,
    update: false,
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
  const [firstScaffoldOnlyOption] = scaffoldOnlyOptions;
  if (parsed.update && firstScaffoldOnlyOption !== undefined) {
    throw new Error(`Option ${firstScaffoldOnlyOption} cannot be used with update.`);
  }
};

const applyPositionals = (parsed: CliArguments, positionals: string[]): void => {
  let remaining = positionals;
  if (remaining[0] === "update") {
    parsed.update = true;
    remaining = remaining.slice(1);
  }

  const [directoryArgument, ...extra] = remaining;
  if (extra.length > 0) {
    throw new Error(`Unexpected extra argument: ${extra[0]}`);
  }

  if (directoryArgument !== undefined) {
    parsed.directoryArgument = directoryArgument;
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
