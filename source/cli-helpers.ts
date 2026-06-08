import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";

import {
  type LintFormatTooling,
  lintFormatToolingOptions,
  lintFormatToolingSchema,
} from "./lint-format-tooling.js";
import { normalizeGitHubUrl, stripPackageScope } from "./name-helpers.js";

export { normalizeGitHubUrl } from "./name-helpers.js";

const execFileAsync = promisify(execFile);

export interface CliArguments {
  codecov?: boolean;
  directoryArgument?: string;
  dryRun: boolean;
  force: boolean;
  help: boolean;
  lintFormatTooling?: LintFormatTooling;
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
type CliBooleanFlag = "dryRun" | "force" | "help" | "version" | "yes" | "zod";

interface GitReaders {
  readGitConfigValue(key: string): Promise<string>;
  readGitRemoteOrigin(): Promise<string>;
}

const cliFlagAliases = new Map<string, CliBooleanFlag>([
  ["--dry-run", "dryRun"],
  ["--force", "force"],
  ["--help", "help"],
  ["--version", "version"],
  ["--yes", "yes"],
  ["--zod", "zod"],
  ["-h", "help"],
  ["-v", "version"],
  ["-y", "yes"],
]);

export const parseCliArguments = (args: string[]): CliArguments => {
  const parsed: CliArguments = {
    dryRun: false,
    force: false,
    help: false,
    version: false,
    yes: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? "";
    if (argument === "--no-codecov") {
      parsed.codecov = false;
      continue;
    }

    if (argument.startsWith("--lint-format=")) {
      parsed.lintFormatTooling = parseLintFormatToolingValue(
        argument.slice("--lint-format=".length),
      );
      continue;
    }

    if (argument === "--lint-format") {
      parsed.lintFormatTooling = parseLintFormatToolingArgument(args, index);
      index += 1;
      continue;
    }

    const flag = cliFlagAliases.get(argument);
    if (flag) {
      parsed[flag] = true;
      continue;
    }

    if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    }

    if (parsed.directoryArgument !== undefined) {
      throw new Error(`Unexpected extra argument: ${argument}`);
    }

    parsed.directoryArgument = argument;
  }

  return parsed;
};

const parseLintFormatToolingArgument = (args: string[], index: number): LintFormatTooling => {
  return parseLintFormatToolingValue(args[index + 1]);
};

const parseLintFormatToolingValue = (value: string | undefined): LintFormatTooling => {
  if (value === undefined || value.length === 0 || value.startsWith("-")) {
    throw new Error(
      `Missing value for --lint-format. Expected one of: ${lintFormatToolingOptions.join(", ")}`,
    );
  }

  const result = lintFormatToolingSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Invalid --lint-format value: ${value}. Expected one of: ${lintFormatToolingOptions.join(", ")}`,
    );
  }

  return result.data;
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
