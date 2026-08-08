import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { githubActionRefs } from "../source/templates/generated-versions.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const workflowsDirectory = join(repositoryRoot, ".github", "workflows");

// Matches every `uses:` key and whatever follows it on the line, pinned or
// not. Collecting only SHA-pinned entries would make an unpinned
// `uses: actions/checkout@v6` invisible to both tests below -- the exact
// regression the pinning is meant to prevent. Anchored to the start of a line
// (allowing the `- ` of a sequence item) so a commented-out `# uses:` line is
// not collected as a reference GitHub would never resolve.
const whitespaceRunPattern = /\s+/gu;
const actionReferencePattern = /^\s*(?:-\s*)?uses:\s*(?<reference>\S+[^\n]*)/gmu;
// `owner/repo[/path]@<40-hex> # vX.Y.Z`, the only shape allowed here.
const pinnedActionReferencePattern = /^[^\s@]+@[0-9a-f]{40} # v\S+$/u;
// `./.github/workflows/x.yml` is this repository's own file, not a third-party
// action, so there is no SHA to pin it to.
const localWorkflowReferencePattern = /^\.{1,2}\//u;

const readWorkflowActionReferences = async (): Promise<Map<string, string[]>> => {
  const entries = await readdir(workflowsDirectory, { withFileTypes: true });
  const workflowFiles = entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/u.test(entry.name))
    .map((entry) => entry.name);
  const referencesByFile = new Map<string, string[]>();

  for (const workflowFile of workflowFiles) {
    const content = await readFile(join(workflowsDirectory, workflowFile), "utf8");
    const references = Array.from(content.matchAll(actionReferencePattern))
      .map((match) => {
        // Destructured rather than indexed so both the lint rule preferring dot
        // access and the compiler rule forbidding it on index signatures agree.
        const { reference } = match.groups ?? {};

        return (reference ?? "").replace(whitespaceRunPattern, " ").trim();
      })
      .filter((reference) => !localWorkflowReferencePattern.test(reference));

    referencesByFile.set(workflowFile, references);
  }

  return referencesByFile;
};

describe("github action pins", () => {
  it("finds action references to check", async () => {
    const referencesByFile = await readWorkflowActionReferences();
    const totalReferences = Array.from(referencesByFile.values()).flat().length;

    // Guards the regex itself: a pattern that silently stops matching would
    // make every assertion below vacuously true.
    expect(totalReferences).toBeGreaterThan(0);
  });

  it("pins every external action to a full-length SHA", async () => {
    const referencesByFile = await readWorkflowActionReferences();
    const unpinned = Array.from(referencesByFile).flatMap(([workflowFile, references]) =>
      references
        .filter((reference) => !pinnedActionReferencePattern.test(reference))
        .map((reference) => `${workflowFile}: ${reference}`),
    );

    // A tag or branch ref is mutable, so the action's code can change under CI
    // without any change landing here. Pin to the commit and record the version
    // in the trailing comment so Renovate can still bump it.
    expect(unpinned).toEqual([]);
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
