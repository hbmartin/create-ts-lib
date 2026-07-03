import { defaultLintFormatTooling, type LintFormatTooling } from "../lint-format-tooling.js";
import { stripPackageScope } from "../name-helpers.js";

export type PackageManager = "pnpm" | "npm" | "yarn";
export type LicenseName = "MIT" | "ISC" | "Apache-2.0" | "UNLICENSED";
export type Bundler = "tsc" | "tsdown";

/**
 * Options that control the files emitted for a generated TypeScript library.
 */
export interface ScaffoldConfig {
  author: string;
  bundler: Bundler;
  description: string;
  githubRepoUrl: string;
  includeCli: boolean;
  includeCodecov: boolean;
  includeJsr: boolean;
  includeSecurityWorkflows: boolean;
  includeZod: boolean;
  license: LicenseName;
  lintFormatTooling: LintFormatTooling;
  packageManager: PackageManager;
  projectName: string;
}

export type ScaffoldConfigOverrides = {
  [Key in keyof ScaffoldConfig]?: ScaffoldConfig[Key] | undefined;
};

const defaultScaffoldConfigValues = {
  author: "",
  bundler: "tsc",
  description: "",
  githubRepoUrl: "",
  includeCli: false,
  includeCodecov: true,
  includeJsr: false,
  includeSecurityWorkflows: false,
  includeZod: false,
  license: "Apache-2.0",
  lintFormatTooling: defaultLintFormatTooling,
  packageManager: "pnpm",
  projectName: "my-lib",
} satisfies ScaffoldConfig;

export const stripUndefinedOverrides = (
  overrides: ScaffoldConfigOverrides,
): Partial<ScaffoldConfig> =>
  Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  ) as Partial<ScaffoldConfig>;

export const defaultScaffoldConfig = (overrides: ScaffoldConfigOverrides = {}): ScaffoldConfig => ({
  ...defaultScaffoldConfigValues,
  ...stripUndefinedOverrides(overrides),
});

export interface GeneratedFile {
  content: string;
  executable?: boolean;
  path: string;
}

interface PackageManagerConfig {
  addCommand: string;
  runPrefix: string;
}

export const packageManagerConfig = {
  npm: {
    addCommand: "npm install",
    runPrefix: "npm run",
  },
  pnpm: {
    addCommand: "pnpm add",
    runPrefix: "pnpm run",
  },
  yarn: {
    addCommand: "yarn add",
    runPrefix: "yarn run",
  },
} satisfies Record<PackageManager, PackageManagerConfig>;

export const getBinName = (projectName: string): string => stripPackageScope(projectName);

export const extractAuthorName = (author: string): string => {
  const trimmedAuthor = author.trim();
  const emailStartIndex = trimmedAuthor.indexOf("<");
  if (emailStartIndex >= 0) {
    const authorName = trimmedAuthor.slice(0, emailStartIndex).trim();
    if (authorName.length > 0) {
      return authorName;
    }

    const emailEndIndex = trimmedAuthor.indexOf(">", emailStartIndex + 1);
    const emailAddress = trimmedAuthor
      .slice(emailStartIndex + 1, emailEndIndex >= 0 ? emailEndIndex : undefined)
      .trim();
    if (emailAddress.length > 0) {
      return emailAddress;
    }
  }

  return trimmedAuthor || "Unknown Author";
};
