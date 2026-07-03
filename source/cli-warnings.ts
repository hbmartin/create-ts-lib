import type { createGitHubRepository, GitHubRepositoryLookupResult } from "./github-cli.js";
import type { NpmPackageNameAvailabilityUnknown } from "./npm-registry.js";

export const formatNpmPackageNameExistsWarning = (packageName: string): string =>
  `Package name "${packageName}" already exists on npm.`;

export const formatNpmAvailabilityUnknownWarning = (
  availability: NpmPackageNameAvailabilityUnknown,
): string => {
  const detail =
    availability.statusCode === undefined
      ? availability.error
      : `npm registry returned HTTP ${availability.statusCode}`;

  return `Could not check npm availability for "${availability.packageName}"; continuing. ${detail}.`;
};

export const formatGitHubRepositoryLookupWarning = (
  lookup: Extract<GitHubRepositoryLookupResult, { status: "unavailable" }>,
): string =>
  `Could not inspect GitHub repositories with gh; continuing with manual URL entry. ${lookup.reason}.`;

export const formatGitHubRepositoryCreateWarning = (
  createResult: Extract<Awaited<ReturnType<typeof createGitHubRepository>>, { status: "failed" }>,
): string =>
  `Could not create GitHub repo "${createResult.owner}/${createResult.repositoryName}" with gh; continuing with ${createResult.url}. ${createResult.reason}.`;
