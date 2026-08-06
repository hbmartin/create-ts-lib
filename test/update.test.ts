import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { scaffoldProject } from "../source/scaffold.js";
import type { ScaffoldConfig } from "../source/templates/files.js";
import { currentCopyrightYear } from "../source/templates/scaffold-config.js";
import { hashFileContent, type ScaffoldState, stateFileName } from "../source/templates/state.js";
import {
  applyUpdatePlan,
  backupFileSuffix,
  planUpdate,
  readScaffoldState,
  type UpdatePlanEntry,
} from "../source/update.js";

const baseConfig: ScaffoldConfig = {
  author: "Harold Martin <harold@example.com>",
  bundler: "tsc",
  copyrightYear: "2026",
  description: "A test library",
  githubRepoUrl: "",
  includeCli: false,
  includeCodecov: false,
  includeCommunityFiles: false,
  includeJsr: false,
  includeSecurityWorkflows: false,
  includeZod: false,
  license: "MIT",
  lintFormatTooling: "oxlint-oxfmt",
  packageManager: "pnpm",
  projectName: "example-lib",
  workspaceMode: false,
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

  it("defaults copyrightYear for state files written before the field existed", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    const state = await readStateFixture(targetDirectory);
    const { copyrightYear: _omitted, ...configWithoutYear } = state.config;
    await writeStateFixture(targetDirectory, {
      ...state,
      config: configWithoutYear as ScaffoldConfig,
    });

    const parsed = await readScaffoldState(targetDirectory);

    expect(parsed.config.copyrightYear).toMatch(/^\d{4}$/u);
  });

  it("rejects directories without a state file", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "create-ts-lib-no-state-"));

    await expect(readScaffoldState(tempDirectory)).rejects.toThrow(
      `No ${stateFileName} found in ${tempDirectory}`,
    );
  });

  it("reports missing state when a path component is a regular file", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "create-ts-lib-state-notdir-"));
    const targetDirectory = join(tempDirectory, "not-a-directory");
    await writeFile(targetDirectory, "plain file\n", "utf8");

    await expect(readScaffoldState(targetDirectory)).rejects.toThrow(
      `No ${stateFileName} found in ${targetDirectory}`,
    );
  });

  it("does not report unreadable state paths as missing state files", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "create-ts-lib-state-directory-"));
    await mkdir(join(tempDirectory, stateFileName));

    let thrownError: unknown;
    try {
      await readScaffoldState(tempDirectory);
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).not.toContain(`No ${stateFileName} found`);
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

  it("replays the recorded copyright year instead of rewriting LICENSE in a later year", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    const state = await readScaffoldState(targetDirectory);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-06-01T00:00:00.000Z"));
    try {
      // Proves the clock really moved, so a regression cannot make this vacuous.
      expect(currentCopyrightYear()).not.toBe(baseConfig.copyrightYear);

      const plan = await planUpdate(targetDirectory, state);

      expect(findEntry(plan.entries, "LICENSE").status).toBe("up-to-date");
      expect(findEntry(plan.entries, "LICENSE").newContent).toContain(baseConfig.copyrightYear);
    } finally {
      vi.useRealTimers();
    }
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

  it("does not classify unreadable generated paths as creatable", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    await rm(join(targetDirectory, "package.json"));
    await mkdir(join(targetDirectory, "package.json"));
    const state = await readScaffoldState(targetDirectory);

    let thrownError: unknown;
    try {
      await planUpdate(targetDirectory, state);
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(Error);
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

describe("applyUpdatePlan selection and backups", () => {
  const makeStale = async (targetDirectory: string, paths: string[]): Promise<void> => {
    const state = await readStateFixture(targetDirectory);
    for (const path of paths) {
      await writeFile(join(targetDirectory, path), staleFixtureContent, "utf8");
      state.files[path] = hashFileContent(staleFixtureContent);
    }
    await writeStateFixture(targetDirectory, state);
  };

  const staleFixtureContent = "# stale\n";

  it("writes only the paths listed in `only`", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    await makeStale(targetDirectory, ["semgrep.yml", "tsconfig.json"]);
    const state = await readScaffoldState(targetDirectory);
    const plan = await planUpdate(targetDirectory, state);

    const written = await applyUpdatePlan(targetDirectory, plan, { only: ["semgrep.yml"] });

    expect(written.map((entry) => entry.path)).toEqual(["semgrep.yml"]);
    await expect(readFile(join(targetDirectory, "tsconfig.json"), "utf8")).resolves.toBe(
      staleFixtureContent,
    );

    // The state file must keep describing what is on disk. Recording the freshly
    // rendered hash for a file that was never written would make the next run
    // read the mismatch as a user edit and demand --force to finish the job.
    const nextPlan = await planUpdate(targetDirectory, await readScaffoldState(targetDirectory));
    expect(findEntry(nextPlan.entries, "tsconfig.json").status).toBe("update");
    expect(findEntry(nextPlan.entries, "semgrep.yml").status).toBe("up-to-date");
  });

  it("keeps a partially applied update resumable across several rounds", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    await makeStale(targetDirectory, ["semgrep.yml", "tsconfig.json", "vitest.config.ts"]);

    for (const path of ["semgrep.yml", "tsconfig.json"]) {
      const plan = await planUpdate(targetDirectory, await readScaffoldState(targetDirectory));
      await applyUpdatePlan(targetDirectory, plan, { only: [path] });
    }

    const finalPlan = await planUpdate(targetDirectory, await readScaffoldState(targetDirectory));
    expect(findEntry(finalPlan.entries, "vitest.config.ts").status).toBe("update");
    expect(finalPlan.entries.some((entry) => entry.status === "skip-modified")).toBe(false);
  });

  it("records no hash for a file it did not create", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    // Stands in for a file the templates gained after this project was
    // scaffolded: missing from disk and from the recorded state.
    await rm(join(targetDirectory, "semgrep.yml"));
    const state = await readStateFixture(targetDirectory);
    delete state.files["semgrep.yml"];
    await writeStateFixture(targetDirectory, state);
    const plan = await planUpdate(targetDirectory, await readScaffoldState(targetDirectory));
    expect(findEntry(plan.entries, "semgrep.yml").status).toBe("create");

    await applyUpdatePlan(targetDirectory, plan, { only: [] });

    // Recording a hash for a file that is not on disk is a claim about nothing.
    const updated = await readStateFixture(targetDirectory);
    expect(Object.hasOwn(updated.files, "semgrep.yml")).toBe(false);
  });

  it("writes nothing for an empty `only` list", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    await makeStale(targetDirectory, ["semgrep.yml"]);
    const state = await readScaffoldState(targetDirectory);
    const plan = await planUpdate(targetDirectory, state);

    const written = await applyUpdatePlan(targetDirectory, plan, { only: [] });

    expect(written).toEqual([]);
    await expect(readFile(join(targetDirectory, "semgrep.yml"), "utf8")).resolves.toBe(
      staleFixtureContent,
    );
  });

  it("backs up user-modified files before a forced overwrite", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    const edited = "rules: []\n";
    await writeFile(join(targetDirectory, "semgrep.yml"), edited, "utf8");
    const state = await readScaffoldState(targetDirectory);
    const plan = await planUpdate(targetDirectory, state);

    const written = await applyUpdatePlan(targetDirectory, plan, { force: true });

    await expect(
      readFile(join(targetDirectory, `semgrep.yml${backupFileSuffix}`), "utf8"),
    ).resolves.toBe(edited);
    expect(findEntry(written, "semgrep.yml").backupPath).toBe(`semgrep.yml${backupFileSuffix}`);
  });

  it("never overwrites an existing backup", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    const existingBackup = "the backup from the previous forced update\n";
    const backupPath = join(targetDirectory, `semgrep.yml${backupFileSuffix}`);
    await writeFile(join(targetDirectory, "semgrep.yml"), "rules: []\n", "utf8");
    await writeFile(backupPath, existingBackup, "utf8");
    const plan = await planUpdate(targetDirectory, await readScaffoldState(targetDirectory));

    const written = await applyUpdatePlan(targetDirectory, plan, { force: true });

    // Clobbering this would destroy the very work the backup exists to protect.
    await expect(readFile(backupPath, "utf8")).resolves.toBe(existingBackup);
    expect(findEntry(written, "semgrep.yml").backupPath).toBe(`semgrep.yml${backupFileSuffix}.1`);
    await expect(readFile(`${backupPath}.1`, "utf8")).resolves.toBe("rules: []\n");
  });

  it("does not back up files that were never modified", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    await makeStale(targetDirectory, ["semgrep.yml"]);
    const state = await readScaffoldState(targetDirectory);
    const plan = await planUpdate(targetDirectory, state);

    // `update` entries match the recorded hash, so nothing is at risk.
    await applyUpdatePlan(targetDirectory, plan, { force: true });

    await expect(
      readFile(join(targetDirectory, `semgrep.yml${backupFileSuffix}`), "utf8"),
    ).rejects.toThrow();
  });

  it("skips the backup when backup is false", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    await writeFile(join(targetDirectory, "semgrep.yml"), "rules: []\n", "utf8");
    const state = await readScaffoldState(targetDirectory);
    const plan = await planUpdate(targetDirectory, state);

    await applyUpdatePlan(targetDirectory, plan, { backup: false, force: true });

    await expect(
      readFile(join(targetDirectory, `semgrep.yml${backupFileSuffix}`), "utf8"),
    ).rejects.toThrow();
  });
});
