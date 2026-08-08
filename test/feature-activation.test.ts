import { describe, expect, it } from "vitest";

import {
  type ConditionalFeature,
  featureInactiveReason,
} from "../source/templates/feature-activation.js";
import {
  buildProjectFiles,
  defaultScaffoldConfig,
  type ScaffoldConfig,
} from "../source/templates/files.js";
import { stateFileName } from "../source/templates/state.js";

/**
 * Guards the whole class of bug where an answer silently stops mattering.
 *
 * Every feature answer reaches the project through files that other answers can
 * suppress, and the dependency is not visible from any one module: Codecov is a
 * step inside the CI workflow, the security workflows sit beside it, and
 * `hasGitHubWorkflows` withholds all of them on three separate conditions. Each
 * time one of those conditions was added, two features quietly became inert and
 * the scaffold summary went on reporting them as applied.
 *
 * So rather than trusting a reading of the templates, this renders each answer
 * both ways and compares what actually changed against
 * `featureInactiveReason`. The check runs in both directions: an answer
 * declared live must change something, and an answer declared inert must change
 * nothing. Adding a fourth condition to `hasGitHubWorkflows` without declaring
 * it fails here.
 */
const featureFields = [
  "includeCli",
  "includeCodecov",
  "includeCommunityFiles",
  "includeJsr",
  "includeSecurityWorkflows",
  "includeZod",
] as const;

type FeatureField = (typeof featureFields)[number];

const isConditional = (field: FeatureField): field is FeatureField & ConditionalFeature =>
  Object.hasOwn(featureInactiveReason, field);

/**
 * Contexts that switch a `hasGitHubWorkflows` condition on or off. `base` is
 * the only one where every answer is expected to reach the project.
 */
const contexts = {
  base: {},
  "no repo URL": { githubRepoUrl: "" },
  "npm project": { packageManager: "npm" },
  "workspace package": { workspaceMode: true },
  "workspace package with npm": { packageManager: "npm", workspaceMode: true },
} as const satisfies Record<string, Partial<ScaffoldConfig>>;

const configFor = (context: Partial<ScaffoldConfig>, overrides: Partial<ScaffoldConfig>) =>
  defaultScaffoldConfig({
    githubRepoUrl: "https://github.com/hbmartin/example-lib",
    packageManager: "pnpm",
    projectName: "example-lib",
    ...context,
    ...overrides,
  });

/**
 * Paths and contents that differ between the two answers, ignoring the state
 * file. The state file always differs -- it records the answer itself -- and
 * recording an answer is not the same as acting on it.
 */
const renderDifference = (
  context: Partial<ScaffoldConfig>,
  field: FeatureField,
): { changed: string[]; removed: string[] } => {
  const off = buildProjectFiles(configFor(context, { [field]: false }));
  const on = buildProjectFiles(configFor(context, { [field]: true }));
  const relevant = (path: string) => path !== stateFileName;

  const changed = on
    .filter((file) => relevant(file.path))
    .filter((file) => {
      const previous = off.find((candidate) => candidate.path === file.path);

      return previous === undefined || previous.content !== file.content;
    })
    .map((file) => file.path);
  const removed = off
    .filter((file) => relevant(file.path))
    .filter((file) => !on.some((candidate) => candidate.path === file.path))
    .map((file) => file.path);

  return { changed, removed };
};

describe("feature activation", () => {
  const cases = Object.entries(contexts).flatMap(([contextName, context]) =>
    featureFields.map((field) => ({ context, contextName, field })),
  );

  it.each(cases)(
    "$field in the $contextName context matches its declared activation",
    ({ context, contextName, field }) => {
      const config = configFor(context, {});
      const declaredReason = isConditional(field)
        ? featureInactiveReason[field](config)
        : undefined;
      const { changed, removed } = renderDifference(context, field);
      const affectsRender = changed.length > 0 || removed.length > 0;

      if (declaredReason === undefined) {
        expect(
          affectsRender,
          `${field} is declared active in the ${contextName} context but toggling it changes nothing`,
        ).toBe(true);
        return;
      }

      expect(
        affectsRender,
        `${field} is declared inert ("${declaredReason}") in the ${contextName} context but toggling it changes ${[...changed, ...removed].join(", ")}`,
      ).toBe(false);
    },
  );

  it("declares every field that is inert somewhere", () => {
    // The bidirectional check above only covers fields already in the table. A
    // field that becomes inert in some context without being declared would
    // fail there as "declared active but changes nothing" -- this asserts the
    // table has no entries that are never inert, so it cannot fill up with
    // stale declarations either.
    const neverInert = Object.keys(featureInactiveReason).filter((feature) =>
      Object.values(contexts).every(
        (context) =>
          featureInactiveReason[feature as ConditionalFeature](configFor(context, {})) ===
          undefined,
      ),
    );

    expect(neverInert).toEqual([]);
  });

  it("keeps at least one context where every answer reaches the project", () => {
    // Guards the guard: if `base` ever stopped rendering workflows, most of the
    // matrix above would assert on inert answers and prove very little.
    for (const field of featureFields) {
      const { changed, removed } = renderDifference(contexts.base, field);
      expect(
        [...changed, ...removed].length,
        `${field} does nothing in the base context`,
      ).toBeGreaterThan(0);
    }
  });
});
