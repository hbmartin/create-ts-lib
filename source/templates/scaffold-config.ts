import { defaultLintFormatTooling, type LintFormatTooling } from "../lint-format-tooling.js";
import { stripPackageScope } from "../name-helpers.js";
import { defaultNodeTarget, type NodeTarget } from "../node-target.js";

export type PackageManager = "pnpm" | "npm" | "yarn";
export type LicenseName = "MIT" | "ISC" | "Apache-2.0" | "UNLICENSED";
export type Bundler = "tsc" | "tsdown";

/**
 * Options that control the files emitted for a generated TypeScript library.
 */
export interface ScaffoldConfig {
  author: string;
  bundler: Bundler;
  /**
   * Copyright year stamped into the generated LICENSE. Recorded at scaffold
   * time and replayed by `update`, so re-running `update` in a later year keeps
   * the original year instead of silently rewriting it.
   */
  copyrightYear: string;
  description: string;
  githubRepoUrl: string;
  includeCli: boolean;
  includeCodecov: boolean;
  includeCommunityFiles: boolean;
  includeJsr: boolean;
  includeSecurityWorkflows: boolean;
  includeZod: boolean;
  license: LicenseName;
  lintFormatTooling: LintFormatTooling;
  /**
   * Node major the generated project targets. Drives `engines.node`, the
   * `@types/node` pin, and the CI matrix together — see `../node-target.ts`.
   */
  nodeTarget: NodeTarget;
  packageManager: PackageManager;
  projectName: string;
  /**
   * Scaffold as a package inside an existing workspace: root-owned files (git
   * ignore, CI workflows, Renovate, editor settings, hooks, the workspace
   * manifest) are left to the parent repository. Nothing outside the target
   * directory is ever written.
   */
  workspaceMode: boolean;
}

export type ScaffoldConfigOverrides = {
  [Key in keyof ScaffoldConfig]?: ScaffoldConfig[Key] | undefined;
};

// `copyrightYear` is excluded because it is clock-derived; it is filled in by
// `defaultScaffoldConfig` so these values stay a static, deterministic object.
const defaultScaffoldConfigValues = {
  author: "",
  bundler: "tsc",
  description: "",
  githubRepoUrl: "",
  includeCli: false,
  includeCodecov: true,
  includeCommunityFiles: false,
  includeJsr: false,
  includeSecurityWorkflows: false,
  includeZod: false,
  license: "Apache-2.0",
  lintFormatTooling: defaultLintFormatTooling,
  nodeTarget: defaultNodeTarget,
  packageManager: "pnpm",
  projectName: "my-lib",
  workspaceMode: false,
} satisfies Omit<ScaffoldConfig, "copyrightYear">;

/**
 * Read once at scaffold time. Every other code path takes the year from
 * `ScaffoldConfig`, keeping `buildProjectFiles` a pure function of its config.
 */
export const currentCopyrightYear = (): string => new Date().getUTCFullYear().toString();

export const stripUndefinedOverrides = (
  overrides: ScaffoldConfigOverrides,
): Partial<ScaffoldConfig> =>
  Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  ) as Partial<ScaffoldConfig>;

export const defaultScaffoldConfig = (overrides: ScaffoldConfigOverrides = {}): ScaffoldConfig => ({
  ...defaultScaffoldConfigValues,
  copyrightYear: currentCopyrightYear(),
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

/**
 * Pulls the address out of an `Name <email>` author string. Returns undefined
 * when the author carries no email, so callers can fall back to a placeholder
 * rather than inventing a contact address.
 */
export const extractAuthorEmail = (author: string): string | undefined => {
  const trimmedAuthor = author.trim();
  const emailStartIndex = trimmedAuthor.indexOf("<");
  if (emailStartIndex < 0) {
    return undefined;
  }

  const emailEndIndex = trimmedAuthor.indexOf(">", emailStartIndex + 1);
  const emailAddress = trimmedAuthor
    .slice(emailStartIndex + 1, emailEndIndex >= 0 ? emailEndIndex : undefined)
    .trim();

  return emailAddress.length > 0 ? emailAddress : undefined;
};
