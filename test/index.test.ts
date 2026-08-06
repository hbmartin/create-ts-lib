import { describe, expect, it } from "vitest";

import { buildProjectFiles, defaultScaffoldConfig, scaffoldProject } from "../source/index.js";

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
});
