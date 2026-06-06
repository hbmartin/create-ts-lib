import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const gitSuffixRegex = /\.git$/u;
const packageScopeRegex = /^@[^/]+\//u;

export interface CliArguments {
  directoryArgument?: string;
  dryRun: boolean;
  help: boolean;
  version: boolean;
  yes: boolean;
}

export interface DetectedDefaults {
  author: string;
  githubRepoUrl: string;
  projectName: string;
}

export type WarningSink = (message: string) => void;

interface GitReaders {
  readGitConfigValue(key: string): Promise<string>;
  readGitRemoteOrigin(): Promise<string>;
}

export const parseCliArguments = (args: string[]): CliArguments => {
  const parsed: CliArguments = {
    dryRun: false,
    help: false,
    version: false,
    yes: false,
  };

  for (const argument of args) {
    if (argument === "--help" || argument === "-h") {
      parsed.help = true;
      continue;
    }

    if (argument === "--version" || argument === "-v") {
      parsed.version = true;
      continue;
    }

    if (argument === "--yes" || argument === "-y") {
      parsed.yes = true;
      continue;
    }

    if (argument === "--dry-run") {
      parsed.dryRun = true;
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

export const deriveDirectoryName = (projectName: string): string =>
  projectName.replace(packageScopeRegex, "");

export const normalizeGitHubUrl = (input: string): string => {
  if (input.length === 0) {
    return "";
  }

  if (input.startsWith("git@github.com:")) {
    return `https://github.com/${input.slice("git@github.com:".length).replace(gitSuffixRegex, "")}`;
  }

  if (input.startsWith("https://github.com/")) {
    return input.replace(gitSuffixRegex, "");
  }

  return input;
};

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
