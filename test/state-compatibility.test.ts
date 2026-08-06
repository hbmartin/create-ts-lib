import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  type ScaffoldState,
  scaffoldConfigSchema,
  stateFileName,
} from "../source/templates/state.js";
import { planUpdate, readScaffoldState } from "../source/update.js";

/**
 * State files frozen from the shape v2.0.0 ships. `create-ts-lib update` reads
 * these from projects in the wild, so every later generator release must keep
 * parsing them: a new `ScaffoldConfig` field has to carry a `.default()` in
 * `scaffoldConfigSchema` or these tests fail.
 */
const fixtureNames = ["v2.0.0-full", "v2.0.0-minimal"];

const readFixture = async (name: string): Promise<string> =>
  readFile(fileURLToPath(new URL(`./__fixtures__/state/${name}.json`, import.meta.url)), "utf8");

const projectWithState = async (stateContent: string): Promise<string> => {
  const targetDirectory = await mkdtemp(join(tmpdir(), "create-ts-lib-state-fixture-"));
  await writeFile(join(targetDirectory, stateFileName), stateContent, "utf8");

  return targetDirectory;
};

describe("scaffold state compatibility", () => {
  it.each(fixtureNames)("parses the %s state file", async (name) => {
    const targetDirectory = await projectWithState(await readFixture(name));

    const state = await readScaffoldState(targetDirectory);

    expect(state.generator).toBe("@hbmartin/create-ts-lib");
    expect(state.config.projectName.length).toBeGreaterThan(0);
    expect(Object.keys(state.files).length).toBeGreaterThan(0);
  });

  it.each(fixtureNames)("plans an update from the %s state file", async (name) => {
    const targetDirectory = await projectWithState(await readFixture(name));
    const state = await readScaffoldState(targetDirectory);

    const plan = await planUpdate(targetDirectory, state);

    // Nothing but the state file exists on disk, so every entry is a `create`.
    expect(plan.entries.length).toBeGreaterThan(0);
    expect(plan.entries.every((entry) => entry.status === "create")).toBe(true);
    expect(plan.entries.map((entry) => entry.path)).not.toContain(stateFileName);
  });

  it("ignores unknown keys so newer state files stay readable", async () => {
    const state = JSON.parse(await readFixture("v2.0.0-minimal")) as ScaffoldState;
    const forwardCompatible = {
      ...state,
      config: { ...state.config, someFutureOption: "enabled" },
      someFutureTopLevelField: 42,
    };
    const targetDirectory = await projectWithState(JSON.stringify(forwardCompatible, null, 2));

    const parsed = await readScaffoldState(targetDirectory);

    expect(parsed.config).not.toHaveProperty("someFutureOption");
    expect(parsed.config.projectName).toBe(state.config.projectName);
  });

  it("defaults fields that a state file predates", async () => {
    // This fixture carries none of `copyrightYear`, `includeCommunityFiles`, or
    // `workspaceMode`, proving each one's `.default()` actually works.
    const targetDirectory = await projectWithState(await readFixture("v2.0.0-pre-defaults"));

    const state = await readScaffoldState(targetDirectory);

    expect(state.config.copyrightYear).toMatch(/^\d{4}$/u);
    expect(state.config.includeCommunityFiles).toBe(false);
    expect(state.config.workspaceMode).toBe(false);
    await expect(planUpdate(targetDirectory, state)).resolves.toBeDefined();
  });

  it("requires every schema field absent from an old state file to be defaulted", async () => {
    // Catches the next added field: without a `.default()` the parse below
    // fails, which is exactly what would break `update` for existing projects.
    const oldConfig = (JSON.parse(await readFixture("v2.0.0-pre-defaults")) as ScaffoldState)
      .config;
    const missingFields = Object.keys(scaffoldConfigSchema.shape).filter(
      (field) => !Object.hasOwn(oldConfig, field),
    );

    const result = scaffoldConfigSchema.safeParse(oldConfig);

    expect(
      result.success,
      `These fields are missing from an older state file and must use .default(): ${missingFields.join(", ")}`,
    ).toBe(true);
    // Guards the guard: if this list empties out, the assertion above is vacuous.
    expect(missingFields.length).toBeGreaterThan(0);
  });

  it("still rejects genuinely invalid values", async () => {
    const state = JSON.parse(await readFixture("v2.0.0-minimal")) as ScaffoldState;
    const targetDirectory = await projectWithState(
      JSON.stringify({ ...state, config: { ...state.config, license: "GPL-3.0" } }, null, 2),
    );

    await expect(readScaffoldState(targetDirectory)).rejects.toThrow(`Invalid ${stateFileName}`);
  });
});
