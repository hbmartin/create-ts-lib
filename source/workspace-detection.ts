import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { readGitRepositoryRoot } from "./git-repository.js";
import { equalResolvedPaths } from "./path-comparison.js";

export type WorkspaceManifest = "package.json" | "pnpm-workspace.yaml";

export interface DetectedWorkspace {
  /** Absolute path of the directory holding the workspace manifest. */
  directory: string;
  manifest: WorkspaceManifest;
}

/**
 * `packages: ["."]` is the single-package pnpm idiom -- it is what this
 * generator emits for a standalone project, purely so pnpm allows build
 * scripts. Treating it as a monorepo would make every generated project look
 * like a workspace root to the next scaffold. A real workspace declares at
 * least one pattern that can match a subdirectory.
 */
const hasNestedPackagePattern = (patterns: readonly unknown[]): boolean =>
  patterns.some(
    (pattern) => typeof pattern === "string" && pattern.trim() !== "." && pattern.trim() !== "./",
  );

const readPackageJsonWorkspacePatterns = (packageJson: unknown): unknown[] | undefined => {
  if (typeof packageJson !== "object" || packageJson === null) {
    return undefined;
  }

  const { workspaces } = packageJson as { workspaces?: unknown };
  if (Array.isArray(workspaces)) {
    return workspaces;
  }

  // Yarn also accepts the object form: { workspaces: { packages: [...] } }.
  if (typeof workspaces === "object" && workspaces !== null) {
    const { packages } = workspaces as { packages?: unknown };
    if (Array.isArray(packages)) {
      return packages;
    }
  }

  return undefined;
};

// A deliberately small scan rather than a YAML dependency: pnpm-workspace.yaml
// package lists are a flat sequence of strings in practice.
const pnpmPackagesBlockPattern = /^packages:\s*$/mu;
const lineBreakPattern = /\r?\n/u;
const yamlSequenceItemPattern = /^\s*-\s*(?<item>.+?)\s*$/u;
const surroundingQuotesPattern = /^["']|["']$/gu;

const readPnpmWorkspacePatterns = (content: string): string[] => {
  const lines = content.split(lineBreakPattern);
  const startIndex = lines.findIndex((line) => pnpmPackagesBlockPattern.test(line));
  if (startIndex < 0) {
    return [];
  }

  const patterns: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    // Destructured rather than indexed so both the lint rule preferring dot
    // access and the compiler rule forbidding it on index signatures are happy.
    const { item } = yamlSequenceItemPattern.exec(line)?.groups ?? {};
    if (item === undefined) {
      // The sequence ended; anything further belongs to another key.
      break;
    }

    patterns.push(item.replace(surroundingQuotesPattern, ""));
  }

  return patterns;
};

const readWorkspaceManifest = async (directory: string): Promise<WorkspaceManifest | undefined> => {
  try {
    const pnpmWorkspace = await readFile(join(directory, "pnpm-workspace.yaml"), "utf8");
    if (hasNestedPackagePattern(readPnpmWorkspacePatterns(pnpmWorkspace))) {
      return "pnpm-workspace.yaml";
    }
  } catch {
    // Fall through to the package.json check.
  }

  let packageJsonContent: string;
  try {
    packageJsonContent = await readFile(join(directory, "package.json"), "utf8");
  } catch {
    return undefined;
  }

  let patterns: unknown[] | undefined;
  try {
    patterns = readPackageJsonWorkspacePatterns(JSON.parse(packageJsonContent));
  } catch {
    // An unparseable package.json is not a workspace declaration.
    return undefined;
  }

  return patterns !== undefined && hasNestedPackagePattern(patterns) ? "package.json" : undefined;
};

const findNearestExistingDirectory = async (directory: string): Promise<string | undefined> => {
  let current = resolve(directory);

  for (;;) {
    try {
      const stats = await stat(current);
      if (stats.isDirectory()) {
        return current;
      }
    } catch {
      // Keep walking up; the target directory usually does not exist yet.
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }

    current = parent;
  }
};

/**
 * Looks for a workspace manifest in `containingDirectory` and its ancestors --
 * that is, the directory the new package will be created inside, not the
 * package directory itself.
 *
 * The search is bounded by the enclosing Git repository: a monorepo is a
 * repository in practice, and stopping at its root keeps an unrelated
 * `package.json` higher up the filesystem (a home directory, say) from being
 * mistaken for the workspace. Returns undefined when the directory is not
 * inside a repository at all.
 */
export const detectWorkspaceRoot = async (
  containingDirectory: string,
): Promise<DetectedWorkspace | undefined> => {
  const nearestDirectory = await findNearestExistingDirectory(containingDirectory);
  if (nearestDirectory === undefined) {
    return undefined;
  }

  // `git rev-parse --show-toplevel` reports a symlink-resolved path (on macOS
  // /var becomes /private/var). Walk in the same namespace, or the repository
  // bound below never matches and the search escapes the repository.
  const startDirectory = await realpath(nearestDirectory).catch(() => nearestDirectory);

  const repositoryRoot = await readGitRepositoryRoot(startDirectory);
  if (repositoryRoot === undefined) {
    return undefined;
  }

  let current = startDirectory;
  for (;;) {
    const manifest = await readWorkspaceManifest(current);
    if (manifest !== undefined) {
      return { directory: current, manifest };
    }

    if (equalResolvedPaths(current, repositoryRoot)) {
      return undefined;
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }

    current = parent;
  }
};
