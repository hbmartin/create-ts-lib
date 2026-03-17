import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { scaffoldProject } from "../source/scaffold.js";
import { buildProjectFiles, getBinName, type ScaffoldConfig } from "../source/templates/files.js";

const baseConfig: ScaffoldConfig = {
  author: "Harold Martin <harold@example.com>",
  description: "A test library",
  githubRepoUrl: "https://github.com/hbmartin/example-lib",
  includeCli: false,
  includeCodecov: true,
  includeReleasePlease: true,
  license: "MIT",
  packageManager: "pnpm",
  projectName: "example-lib",
};

describe("buildProjectFiles", () => {
  it("includes release and workflow files for GitHub repositories", () => {
    const files = buildProjectFiles(baseConfig);
    const filePaths = files.map((file) => file.path);
    const ciWorkflow = files.find((file) => file.path === ".github/workflows/ci.yml");
    const releaseWorkflow = files.find((file) => file.path === ".github/workflows/release-please.yml");

    expect(filePaths).toContain(".github/workflows/ci.yml");
    expect(filePaths).toContain(".github/workflows/semantic-pr.yml");
    expect(filePaths).toContain(".github/workflows/release-please.yml");
    expect(filePaths).toContain("release-please-config.json");
    expect(ciWorkflow?.content).toContain('cache: "pnpm"');
    expect(ciWorkflow?.content).toContain("pnpm exec publint --pack npm");
    expect(releaseWorkflow?.content).toContain("with:\n          version: 9");
  });

  it("adds CLI files and binary metadata when requested", async () => {
    const files = buildProjectFiles({
      ...baseConfig,
      includeCli: true,
      packageManager: "npm",
      projectName: "@scope/example-cli",
    });
    const packageJsonFile = files.find((file) => file.path === "package.json");

    expect(files.map((file) => file.path)).toContain("source/cli.ts");
    expect(packageJsonFile?.content).toContain(`"${getBinName("@scope/example-cli")}": "dist/cli.js"`);
    expect(packageJsonFile?.content).toContain(`"meow": "^14.0.0"`);
    expect(packageJsonFile?.content).not.toContain(`"packageManager"`);
  });

  it("skips GitHub workflows when no repository URL is provided", () => {
    const filePaths = buildProjectFiles({
      ...baseConfig,
      githubRepoUrl: "",
      includeReleasePlease: false,
    }).map((file) => file.path);

    expect(filePaths).not.toContain(".github/workflows/ci.yml");
    expect(filePaths).not.toContain(".github/workflows/release-please.yml");
  });
});

describe("scaffoldProject", () => {
  it("writes the generated files to disk", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "create-ts-lib-"));

    await scaffoldProject(
      {
        ...baseConfig,
        githubRepoUrl: "",
        includeReleasePlease: false,
      },
      {
        postScaffold: false,
        targetDirectory: join(tempDirectory, "example-lib"),
      },
    );

    const packageJson = await readFile(join(tempDirectory, "example-lib", "package.json"), "utf8");
    const sourceFiles = await readdir(join(tempDirectory, "example-lib", "source"));

    expect(packageJson).toContain(`"name": "example-lib"`);
    expect(sourceFiles).toContain("index.ts");
  });
});
