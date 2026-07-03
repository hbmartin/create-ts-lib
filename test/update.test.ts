import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { scaffoldProject } from "../source/scaffold.js";
import type { ScaffoldConfig } from "../source/templates/files.js";
import { hashFileContent, type ScaffoldState, stateFileName } from "../source/templates/state.js";
import {
  applyUpdatePlan,
  planUpdate,
  readScaffoldState,
  type UpdatePlanEntry,
} from "../source/update.js";

const baseConfig: ScaffoldConfig = {
  author: "Harold Martin <harold@example.com>",
  bundler: "tsc",
  description: "A test library",
  githubRepoUrl: "",
  includeCli: false,
  includeCodecov: false,
  includeJsr: false,
  includeSecurityWorkflows: false,
  includeZod: false,
  license: "MIT",
  lintFormatTooling: "oxlint-oxfmt",
  packageManager: "pnpm",
  projectName: "example-lib",
};

const scaffoldFixtureProject = async (): Promise<string> => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "create-ts-lib-update-"));
  const targetDirectory = join(tempDirectory, "example-lib");

  await scaffoldProject(baseConfig, {
    postScaffold: false,
    targetDirectory,
  });

  return targetDirectory;
};

const readStateFixture = async (targetDirectory: string): Promise<ScaffoldState> =>
  JSON.parse(await readFile(join(targetDirectory, stateFileName), "utf8")) as ScaffoldState;

const writeStateFixture = async (targetDirectory: string, state: ScaffoldState): Promise<void> => {
  await writeFile(join(targetDirectory, stateFileName), JSON.stringify(state, null, 2), "utf8");
};

const findEntry = (entries: UpdatePlanEntry[], path: string): UpdatePlanEntry => {
  const entry = entries.find((candidate) => candidate.path === path);
  if (!entry) {
    throw new Error(`Expected update plan entry for ${path}`);
  }

  return entry;
};

describe("readScaffoldState", () => {
  it("reads the state file written by scaffoldProject", async () => {
    const targetDirectory = await scaffoldFixtureProject();

    const state = await readScaffoldState(targetDirectory);

    expect(state.config).toEqual(baseConfig);
    expect(state.generator).toBe("@hbmartin/create-ts-lib");
    expect(Object.keys(state.files)).toContain("package.json");
    expect(Object.keys(state.files)).not.toContain(stateFileName);
  });

  it("rejects directories without a state file", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "create-ts-lib-no-state-"));

    await expect(readScaffoldState(tempDirectory)).rejects.toThrow(
      `No ${stateFileName} found in ${tempDirectory}`,
    );
  });

  it("rejects state files that are not valid JSON", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "create-ts-lib-bad-json-"));
    await writeFile(join(tempDirectory, stateFileName), "not json\n", "utf8");

    await expect(readScaffoldState(tempDirectory)).rejects.toThrow("as JSON");
  });

  it("rejects state files with invalid config values", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    const state = await readStateFixture(targetDirectory);
    (state.config as { license: string }).license = "GPL-3.0";
    await writeStateFixture(targetDirectory, state);

    await expect(readScaffoldState(targetDirectory)).rejects.toThrow(`Invalid ${stateFileName}`);
  });
});

describe("planUpdate", () => {
  it("classifies untouched projects as up to date", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    const state = await readScaffoldState(targetDirectory);

    const plan = await planUpdate(targetDirectory, state);

    expect(plan.entries.length).toBeGreaterThan(0);
    expect(plan.entries.every((entry) => entry.status === "up-to-date")).toBe(true);
    expect(plan.entries.map((entry) => entry.path)).not.toContain(stateFileName);
  });

  it("classifies user-modified files, deleted files, and stale-but-unmodified files", async () => {
    const targetDirectory = await scaffoldFixtureProject();

    // User edited semgrep.yml after scaffolding.
    await writeFile(join(targetDirectory, "semgrep.yml"), "rules: []\n", "utf8");
    // User deleted lefthook.yml.
    await rm(join(targetDirectory, "lefthook.yml"));
    // tsconfig.json matches the hash recorded at scaffold time, but the
    // template has since changed: simulate by rewriting disk content and
    // recording that content's hash as the scaffold-time hash.
    const staleContent = '{\n  "compilerOptions": {}\n}\n';
    await writeFile(join(targetDirectory, "tsconfig.json"), staleContent, "utf8");
    const state = await readScaffoldState(targetDirectory);
    state.files["tsconfig.json"] = hashFileContent(staleContent);
    await writeStateFixture(targetDirectory, state);

    const plan = await planUpdate(targetDirectory, state);

    expect(findEntry(plan.entries, "semgrep.yml").status).toBe("skip-modified");
    expect(findEntry(plan.entries, "lefthook.yml").status).toBe("create");
    expect(findEntry(plan.entries, "tsconfig.json").status).toBe("update");
    expect(findEntry(plan.entries, "package.json").status).toBe("up-to-date");
  });
});

describe("applyUpdatePlan", () => {
  it("writes safe updates, recreates missing files, and skips user-modified files", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    const userContent = "rules: []\n";
    await writeFile(join(targetDirectory, "semgrep.yml"), userContent, "utf8");
    await rm(join(targetDirectory, "lefthook.yml"));
    const staleContent = '{\n  "compilerOptions": {}\n}\n';
    await writeFile(join(targetDirectory, "tsconfig.json"), staleContent, "utf8");
    const state = await readScaffoldState(targetDirectory);
    state.files["tsconfig.json"] = hashFileContent(staleContent);
    await writeStateFixture(targetDirectory, state);

    const plan = await planUpdate(targetDirectory, state);
    const written = await applyUpdatePlan(targetDirectory, plan);

    expect(written.map((entry) => entry.path).sort()).toEqual(["lefthook.yml", "tsconfig.json"]);
    await expect(readFile(join(targetDirectory, "semgrep.yml"), "utf8")).resolves.toBe(userContent);
    await expect(readFile(join(targetDirectory, "lefthook.yml"), "utf8")).resolves.toContain(
      "pre-commit",
    );
    await expect(readFile(join(targetDirectory, "tsconfig.json"), "utf8")).resolves.toContain(
      "@sindresorhus/tsconfig",
    );

    // The state file is rewritten so the next run is clean apart from the
    // still-modified semgrep.yml.
    const nextState = await readScaffoldState(targetDirectory);
    const nextPlan = await planUpdate(targetDirectory, nextState);
    expect(findEntry(nextPlan.entries, "lefthook.yml").status).toBe("up-to-date");
    expect(findEntry(nextPlan.entries, "tsconfig.json").status).toBe("up-to-date");
    expect(findEntry(nextPlan.entries, "semgrep.yml").status).toBe("skip-modified");
  });

  it("overwrites user-modified files only with force", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    await writeFile(join(targetDirectory, "semgrep.yml"), "rules: []\n", "utf8");
    const state = await readScaffoldState(targetDirectory);

    const plan = await planUpdate(targetDirectory, state);
    const written = await applyUpdatePlan(targetDirectory, plan, { force: true });

    expect(written.map((entry) => entry.path)).toEqual(["semgrep.yml"]);
    await expect(readFile(join(targetDirectory, "semgrep.yml"), "utf8")).resolves.toContain(
      "no-child-process-exec",
    );
  });
});
