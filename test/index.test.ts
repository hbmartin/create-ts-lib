import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildProjectFiles,
  defaultScaffoldConfig,
  type ScaffoldConfig,
  scaffoldProject,
} from "../source/index.js";

describe("public API", () => {
  it("exports scaffoldProject from the package root", () => {
    expect(scaffoldProject).toBeTypeOf("function");
  });

  it("renders the generated file list without touching disk", () => {
    const files = buildProjectFiles(defaultScaffoldConfig({ projectName: "example-lib" }));
    const paths = files.map((file) => file.path);

    expect(paths).toContain("package.json");
    expect(paths).toContain("source/index.ts");
    expect(files.every((file) => typeof file.content === "string")).toBe(true);
  });

  // JavaScript callers reach these entry points with no type checking at all.
  // Without validation a bad `packageManager` surfaces as a TypeError from a
  // lookup table rather than a message naming the field.
  const invalidConfig = defaultScaffoldConfig({
    packageManager: "bun" as ScaffoldConfig["packageManager"],
    projectName: "example-lib",
  });

  it("rejects an invalid config from buildProjectFiles", () => {
    expect(() => buildProjectFiles(invalidConfig)).toThrow(
      "Invalid scaffold config: packageManager",
    );
  });

  it("applies schema defaults instead of rendering them as undefined", () => {
    // The fields carrying a `.default()` for state-file compatibility make a
    // partial object validate while still being partial. Rendering the caller's
    // own object put `Copyright (c) undefined` into LICENSE.
    const { copyrightYear: _omitted, ...withoutCopyrightYear } = defaultScaffoldConfig({
      author: "Ada Lovelace",
      license: "MIT",
      projectName: "example-lib",
    });

    const license = buildProjectFiles(withoutCopyrightYear as ScaffoldConfig).find(
      (file) => file.path === "LICENSE",
    );

    expect(license?.content).not.toContain("undefined");
    expect(license?.content).toMatch(/Copyright \(c\) \d{4} Ada Lovelace/u);
  });

  it("rejects an invalid config from scaffoldProject", async () => {
    await expect(
      scaffoldProject(invalidConfig, {
        postScaffold: false,
        targetDirectory: join(tmpdir(), "create-ts-lib-never-written"),
      }),
    ).rejects.toThrow("Invalid scaffold config: packageManager");
  });
});
