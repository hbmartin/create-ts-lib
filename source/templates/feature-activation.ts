import { hasGitHubWorkflows } from "./readme.js";
import type { ScaffoldConfig } from "./scaffold-config.js";

/**
 * Feature answers that only reach the generated project through a file some
 * other answer can suppress.
 *
 * Codecov is a step inside the CI workflow and the security workflows sit
 * beside it, so both vanish with `.github/workflows/**`; the community-health
 * files are dropped outright in workspace mode. Nothing in the render itself
 * says so -- the dependency is spread across `files.ts`, `workflows.ts`, and
 * `readme.ts` -- so it is declared here, and `test/feature-activation.test.ts`
 * checks the declaration against what toggling each answer actually changes.
 */
export type ConditionalFeature =
  | "includeCodecov"
  | "includeCommunityFiles"
  | "includeSecurityWorkflows";

/**
 * Why nothing in `.github/workflows/**` is emitted, or undefined when it is.
 * Ordered so the most specific answer wins: a workspace package inherits CI
 * from the root whatever its other answers say.
 */
const missingWorkflowsReason = (config: ScaffoldConfig): string | undefined => {
  if (hasGitHubWorkflows(config)) {
    return undefined;
  }

  if (config.workspaceMode) {
    return "root-owned";
  }

  if (config.githubRepoUrl.length === 0) {
    return "needs a repo URL";
  }

  return "generated CI is pnpm-only";
};

/**
 * Returns a short reason when the answer cannot affect this project, or
 * undefined when it does. Reporting must not present an inert answer as
 * something the scaffold did.
 */
export const featureInactiveReason = {
  includeCodecov: missingWorkflowsReason,
  includeCommunityFiles: (config: ScaffoldConfig): string | undefined =>
    config.workspaceMode ? "root-owned" : undefined,
  includeSecurityWorkflows: missingWorkflowsReason,
} satisfies Record<ConditionalFeature, (config: ScaffoldConfig) => string | undefined>;
