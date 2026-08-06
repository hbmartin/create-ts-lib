import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { githubActionRefs } from "../source/templates/generated-versions.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const workflowsDirectory = join(repositoryRoot, ".github", "workflows");

// Matches a SHA-pinned action reference plus its trailing version comment, e.g.
// `uses: actions/checkout@df4cb1c... # v6.0.3`.
const whitespaceRunPattern = /\s+/gu;
const pinnedActionReferencePattern = /uses:\s*(?<reference>[^\s@]+@[0-9a-f]{40}\s*#\s*v[^\s]+)/gu;

const readWorkflowActionReferences = async (): Promise<Map<string, string[]>> => {
  const entries = await readdir(workflowsDirectory, { withFileTypes: true });
  const workflowFiles = entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/u.test(entry.name))
    .map((entry) => entry.name);
  const referencesByFile = new Map<string, string[]>();

  for (const workflowFile of workflowFiles) {
    const content = await readFile(join(workflowsDirectory, workflowFile), "utf8");
    const references = Array.from(content.matchAll(pinnedActionReferencePattern)).map((match) => {
      const { reference } = match.groups ?? {};

      return reference?.replace(whitespaceRunPattern, " ").trim() ?? "";
    });

    referencesByFile.set(workflowFile, references);
  }

  return referencesByFile;
};

describe("github action pins", () => {
  it("finds SHA-pinned action references to check", async () => {
    const referencesByFile = await readWorkflowActionReferences();
    const totalReferences = Array.from(referencesByFile.values()).flat().length;

    // Guards the regex itself: a pattern that silently stops matching would
    // make every assertion below vacuously true.
    expect(totalReferences).toBeGreaterThan(0);
  });

  it("mirrors every workflow action pin in githubActionRefs", async () => {
    const referencesByFile = await readWorkflowActionReferences();
    const knownReferences = new Set<string>(Object.values(githubActionRefs));
    const drifted = Array.from(referencesByFile).flatMap(([workflowFile, references]) =>
      references
        .filter((reference) => !knownReferences.has(reference))
        .map((reference) => `${workflowFile}: ${reference}`),
    );

    // Renovate updates `.github/workflows/**` but cannot see the copies that
    // generated projects receive. When this fails, apply the same bump to
    // `githubActionRefs` in source/templates/generated-versions.ts so scaffolded
    // projects do not stay pinned to a stale action.
    expect(drifted).toEqual([]);
  });
});
