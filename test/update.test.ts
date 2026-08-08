import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { scaffoldProject } from "../source/scaffold.js";
import type { ScaffoldConfig } from "../source/templates/files.js";
import { currentCopyrightYear } from "../source/templates/scaffold-config.js";
import { hashFileContent, type ScaffoldState, stateFileName } from "../source/templates/state.js";
import {
  applyUpdatePlan,
  backupFileSuffix,
  type OrphanRemovalResult,
  type OrphanStatus,
  planUpdate,
  readScaffoldState,
  type UpdatePlan,
  type UpdatePlanEntry,
} from "../source/update.js";
import { createTempDirectory, createTempPath } from "./helpers/temp-directory.js";

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
  nodeTarget: "24",
  packageManager: "pnpm",
  projectName: "example-lib",
  workspaceMode: false,
};

const scaffoldFixtureProject = async (): Promise<string> => {
  const targetDirectory = await createTempPath("create-ts-lib-update-", "example-lib");

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

const orphanStatusFor = (plan: UpdatePlan, path: string): OrphanStatus | undefined =>
  plan.orphans.find((orphan) => orphan.path === path)?.status;

/**
 * Flips a recorded config option so the next render drops files the state file
 * still records — the realistic way a project grows orphans, and the reason
 * "absent from the render" cannot be read as "the templates dropped it".
 */
const retoolProject = async (
  targetDirectory: string,
  config: Partial<ScaffoldConfig>,
): Promise<void> => {
  const state = await readStateFixture(targetDirectory);
  await writeStateFixture(targetDirectory, {
    ...state,
    config: { ...state.config, ...config },
  });
};

/** `retoolProject`, then the plan the re-read state produces. */
const planAfterRetool = async (
  targetDirectory: string,
  config: Partial<ScaffoldConfig>,
): Promise<UpdatePlan> => {
  await retoolProject(targetDirectory, config);

  return planUpdate(targetDirectory, await readScaffoldState(targetDirectory));
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
    const tempDirectory = await createTempDirectory("create-ts-lib-no-state-");

    await expect(readScaffoldState(tempDirectory)).rejects.toThrow(
      `No ${stateFileName} found in ${tempDirectory}`,
    );
  });

  it("reports missing state when a path component is a regular file", async () => {
    const tempDirectory = await createTempDirectory("create-ts-lib-state-notdir-");
    const targetDirectory = join(tempDirectory, "not-a-directory");
    await writeFile(targetDirectory, "plain file\n", "utf8");

    await expect(readScaffoldState(targetDirectory)).rejects.toThrow(
      `No ${stateFileName} found in ${targetDirectory}`,
    );
  });

  it("does not report unreadable state paths as missing state files", async () => {
    const tempDirectory = await createTempDirectory("create-ts-lib-state-directory-");
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
    const tempDirectory = await createTempDirectory("create-ts-lib-bad-json-");
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

describe("orphaned files", () => {
  // The base fixture uses oxlint-oxfmt, so flipping to Biome orphans both
  // oxlint config files and creates biome.jsonc.
  const orphanedByBiome = [".oxfmtrc.json", ".oxlintrc.json"];

  it("reports files the render no longer produces, and never as plan entries", async () => {
    const targetDirectory = await scaffoldFixtureProject();

    const plan = await planAfterRetool(targetDirectory, { lintFormatTooling: "biome" });

    for (const path of orphanedByBiome) {
      expect(orphanStatusFor(plan, path)).toBe("orphan-unmodified");
      // An orphan has no rendered content, so it must never reach the entry
      // list where every status means "pending work to write".
      expect(plan.entries.some((entry) => entry.path === path)).toBe(false);
    }
    expect(findEntry(plan.entries, "biome.jsonc").status).toBe("create");
  });

  it("distinguishes edited and already-deleted orphans", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    await writeFile(join(targetDirectory, ".oxfmtrc.json"), "{ /* mine */ }\n", "utf8");
    await rm(join(targetDirectory, ".oxlintrc.json"));

    const plan = await planAfterRetool(targetDirectory, { lintFormatTooling: "biome" });

    expect(orphanStatusFor(plan, ".oxfmtrc.json")).toBe("orphan-modified");
    expect(orphanStatusFor(plan, ".oxlintrc.json")).toBe("orphan-gone");
  });

  it("never treats its own state file as an orphan", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    const state = await readStateFixture(targetDirectory);
    // A future release could start recording it; `update` still must not be able
    // to delete the record it reads on the next run.
    state.files[stateFileName] = hashFileContent("anything");
    await writeStateFixture(targetDirectory, state);

    const plan = await planUpdate(targetDirectory, await readScaffoldState(targetDirectory));

    expect(orphanStatusFor(plan, stateFileName)).toBeUndefined();
  });

  it.each(["../escaped.txt", "/etc/hosts"])(
    "flags the recorded path %j as pointing outside the project",
    async (escapingPath) => {
      const targetDirectory = await scaffoldFixtureProject();
      const state = await readStateFixture(targetDirectory);
      state.files[escapingPath] = hashFileContent("anything");
      await writeStateFixture(targetDirectory, state);

      const plan = await planUpdate(targetDirectory, await readScaffoldState(targetDirectory));

      expect(orphanStatusFor(plan, escapingPath)).toBe("orphan-external");
    },
  );

  it("keeps recording an orphan the run did not clear", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    const plan = await planAfterRetool(targetDirectory, { lintFormatTooling: "biome" });

    // The first apply of any kind used to erase the record, because the state
    // file is rebuilt from the render and an orphan is by definition not in it.
    await applyUpdatePlan(targetDirectory, plan);

    const nextPlan = await planUpdate(targetDirectory, await readScaffoldState(targetDirectory));
    for (const path of orphanedByBiome) {
      expect(orphanStatusFor(nextPlan, path)).toBe("orphan-unmodified");
    }
  });

  it("drops the record for an orphan that is already gone", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    await rm(join(targetDirectory, ".oxfmtrc.json"));
    const plan = await planAfterRetool(targetDirectory, { lintFormatTooling: "biome" });

    await applyUpdatePlan(targetDirectory, plan);

    const state = await readStateFixture(targetDirectory);
    expect(Object.hasOwn(state.files, ".oxfmtrc.json")).toBe(false);
    const nextPlan = await planUpdate(targetDirectory, await readScaffoldState(targetDirectory));
    expect(orphanStatusFor(nextPlan, ".oxfmtrc.json")).toBeUndefined();
  });

  it("leaves everything on disk when a config toggle orphans a batch of files", async () => {
    const targetDirectory = await scaffoldFixtureProject();

    // Workspace mode is the widest blast radius a single field has.
    const plan = await planAfterRetool(targetDirectory, { workspaceMode: true });
    await applyUpdatePlan(targetDirectory, plan);

    const state = await readStateFixture(targetDirectory);
    for (const path of [".gitignore", "lefthook.yml", "pnpm-workspace.yaml"]) {
      expect(orphanStatusFor(plan, path)).toBe("orphan-unmodified");
      await expect(readFile(join(targetDirectory, path), "utf8")).resolves.toBeTypeOf("string");
      expect(Object.hasOwn(state.files, path)).toBe(true);
    }
  });
});

describe("removing orphaned files", () => {
  const removeAll = { force: true, removeOrphans: true } as const;

  it.each([
    ["force alone", { force: true }],
    ["removeOrphans alone", { removeOrphans: true }],
    ["neither", {}],
  ])("removes nothing with %s", async (_name, options) => {
    const targetDirectory = await scaffoldFixtureProject();
    const plan = await planAfterRetool(targetDirectory, { lintFormatTooling: "biome" });

    await applyUpdatePlan(targetDirectory, plan, options);

    await expect(readFile(join(targetDirectory, ".oxfmtrc.json"), "utf8")).resolves.toContain("{");
    const state = await readStateFixture(targetDirectory);
    expect(Object.hasOwn(state.files, ".oxfmtrc.json")).toBe(true);
  });

  it("removes unmodified orphans and reports each one", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    const plan = await planAfterRetool(targetDirectory, { lintFormatTooling: "biome" });
    const results: OrphanRemovalResult[] = [];

    await applyUpdatePlan(targetDirectory, plan, {
      ...removeAll,
      onOrphan: (result) => results.push(result),
    });

    await expect(readFile(join(targetDirectory, ".oxfmtrc.json"), "utf8")).rejects.toThrow();
    expect(results).toEqual([
      { outcome: "removed", path: ".oxfmtrc.json" },
      { outcome: "removed", path: ".oxlintrc.json" },
    ]);
    const state = await readStateFixture(targetDirectory);
    expect(Object.hasOwn(state.files, ".oxfmtrc.json")).toBe(false);
  });

  it("never removes an orphan the user edited, even with both flags", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    const edited = "{ /* mine */ }\n";
    await writeFile(join(targetDirectory, ".oxfmtrc.json"), edited, "utf8");
    const plan = await planAfterRetool(targetDirectory, { lintFormatTooling: "biome" });

    await applyUpdatePlan(targetDirectory, plan, removeAll);

    // A config toggle plus the most destructive flag pair still cannot destroy
    // work the user did.
    await expect(readFile(join(targetDirectory, ".oxfmtrc.json"), "utf8")).resolves.toBe(edited);
    const state = await readStateFixture(targetDirectory);
    expect(Object.hasOwn(state.files, ".oxfmtrc.json")).toBe(true);
  });

  it("never removes a recorded path that escapes the target directory", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    const outsidePath = join(targetDirectory, "..", "escaped.txt");
    const outsideContent = "not ours to delete\n";
    await writeFile(outsidePath, outsideContent, "utf8");
    const state = await readStateFixture(targetDirectory);
    // The recorded hash genuinely matches, so containment is the only thing
    // standing between this file and `rm`.
    state.files["../escaped.txt"] = hashFileContent(outsideContent);
    await writeStateFixture(targetDirectory, state);
    const plan = await planUpdate(targetDirectory, await readScaffoldState(targetDirectory));

    await applyUpdatePlan(targetDirectory, plan, removeAll);

    await expect(readFile(outsidePath, "utf8")).resolves.toBe(outsideContent);
    expect(Object.hasOwn((await readStateFixture(targetDirectory)).files, "../escaped.txt")).toBe(
      true,
    );
  });

  it("classifies a path behind a symlinked directory as orphan-external", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    const outsideDirectory = await createTempDirectory("create-ts-lib-symlink-out-");
    const outsideContent = "not ours to delete\n";
    await writeFile(join(outsideDirectory, "known.txt"), outsideContent, "utf8");
    await symlink(outsideDirectory, join(targetDirectory, "linked"));
    const state = await readStateFixture(targetDirectory);
    // `linked/known.txt` is lexically inside the project and the hash matches:
    // only symlink resolution stands between the external file and `rm`.
    state.files["linked/known.txt"] = hashFileContent(outsideContent);
    await writeStateFixture(targetDirectory, state);

    const plan = await planUpdate(targetDirectory, await readScaffoldState(targetDirectory));

    expect(orphanStatusFor(plan, "linked/known.txt")).toBe("orphan-external");
    await applyUpdatePlan(targetDirectory, plan, removeAll);
    await expect(readFile(join(outsideDirectory, "known.txt"), "utf8")).resolves.toBe(
      outsideContent,
    );
  });

  it("never removes through a symlinked directory, even when the plan says unmodified", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    const outsideDirectory = await createTempDirectory("create-ts-lib-symlink-lie-");
    const outsideContent = "not ours to delete\n";
    await writeFile(join(outsideDirectory, "known.txt"), outsideContent, "utf8");
    await symlink(outsideDirectory, join(targetDirectory, "linked"));
    const state = await readStateFixture(targetDirectory);
    state.files["linked/known.txt"] = hashFileContent(outsideContent);
    await writeStateFixture(targetDirectory, state);
    const plan = await planUpdate(targetDirectory, await readScaffoldState(targetDirectory));
    // A programmatic caller can hand `applyUpdatePlan` any plan at all, so the
    // delete must re-derive the real location rather than trust the classifier.
    const doctored = plan.orphans.find((orphan) => orphan.path === "linked/known.txt");
    if (doctored === undefined) {
      throw new Error("Expected linked/known.txt in the orphan list");
    }
    doctored.status = "orphan-unmodified";
    const results: OrphanRemovalResult[] = [];

    await applyUpdatePlan(targetDirectory, plan, {
      ...removeAll,
      onOrphan: (result) => results.push(result),
    });

    await expect(readFile(join(outsideDirectory, "known.txt"), "utf8")).resolves.toBe(
      outsideContent,
    );
    expect(results).toContainEqual({ outcome: "skipped-external", path: "linked/known.txt" });
  });

  it("skips an orphan that changed between the plan and the apply", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    const plan = await planAfterRetool(targetDirectory, { lintFormatTooling: "biome" });
    const results: OrphanRemovalResult[] = [];

    // An editor saving while the prompt is open retroactively voids the
    // "nothing to lose" premise that justified skipping a backup.
    await writeFile(join(targetDirectory, ".oxfmtrc.json"), "{ /* just saved */ }\n", "utf8");
    await applyUpdatePlan(targetDirectory, plan, {
      ...removeAll,
      onOrphan: (result) => results.push(result),
    });

    await expect(readFile(join(targetDirectory, ".oxfmtrc.json"), "utf8")).resolves.toContain(
      "just saved",
    );
    expect(results).toContainEqual({ outcome: "skipped-changed", path: ".oxfmtrc.json" });
    const nextPlan = await planUpdate(targetDirectory, await readScaffoldState(targetDirectory));
    expect(orphanStatusFor(nextPlan, ".oxfmtrc.json")).toBe("orphan-modified");
  });

  it("removes only the orphans listed in `only`, and stays resumable", async () => {
    const targetDirectory = await scaffoldFixtureProject();
    const plan = await planAfterRetool(targetDirectory, { lintFormatTooling: "biome" });

    await applyUpdatePlan(targetDirectory, plan, { ...removeAll, only: [".oxfmtrc.json"] });

    await expect(readFile(join(targetDirectory, ".oxlintrc.json"), "utf8")).resolves.toContain("{");
    const nextPlan = await planUpdate(targetDirectory, await readScaffoldState(targetDirectory));
    expect(orphanStatusFor(nextPlan, ".oxfmtrc.json")).toBeUndefined();
    expect(orphanStatusFor(nextPlan, ".oxlintrc.json")).toBe("orphan-unmodified");

    await applyUpdatePlan(targetDirectory, nextPlan, removeAll);

    await expect(readFile(join(targetDirectory, ".oxlintrc.json"), "utf8")).rejects.toThrow();
  });
});
