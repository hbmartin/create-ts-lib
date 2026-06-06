import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { flattenDiagnosticMessageText, parseConfigFileTextToJson } from "typescript";
import { describe, expect, it } from "vitest";

import { scaffoldProject } from "../source/scaffold.js";
import { renderBiomeJsonc } from "../source/templates/biome.js";
import {
  buildProjectFiles,
  getBinName,
  type LicenseName,
  type PackageManager,
  type ScaffoldConfig,
} from "../source/templates/files.js";

const baseConfig: ScaffoldConfig = {
  author: "Harold Martin <harold@example.com>",
  description: "A test library",
  githubRepoUrl: "https://github.com/hbmartin/example-lib",
  includeCli: false,
  includeCodecov: true,
  license: "MIT",
  packageManager: "pnpm",
  projectName: "example-lib",
};

interface GeneratedPackageJson {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  exports: {
    ".": Record<string, string>;
  };
  scripts: {
    format: string;
    lint: string;
  } & Record<string, string>;
}

describe("buildProjectFiles", () => {
  it("includes GitHub CI and semantic PR workflows without release-please files", () => {
    const files = buildProjectFiles(baseConfig);
    const filePaths = files.map((file) => file.path);
    const ciWorkflow = files.find((file) => file.path === ".github/workflows/ci.yml");

    expect(filePaths).toContain(".github/workflows/ci.yml");
    expect(filePaths).toContain(".github/workflows/semantic-pr.yml");
    expect(filePaths).not.toContain(".github/workflows/release-please.yml");
    expect(filePaths).not.toContain("release-please-config.json");
    expect(filePaths).not.toContain(".release-please-manifest.json");
    expect(ciWorkflow?.content).toContain("version: 10");
    expect(ciWorkflow?.content).toContain("persist-credentials: false");
    expect(ciWorkflow?.content).toContain("pnpm exec publint --pack npm");
    expect(ciWorkflow?.content).toContain("pnpm run lint");
    expect(ciWorkflow?.content).not.toContain("setup-biome");
    expect(ciWorkflow?.content).not.toContain("biome ci");
  });

  it("emits Lefthook and Oxc tooling instead of Husky and commitlint", () => {
    const files = buildProjectFiles(baseConfig);
    const filePaths = files.map((file) => file.path);
    const packageJson = parseGeneratedJson<GeneratedPackageJson>(files, "package.json");
    const vitestConfig = findGeneratedFile(files, "vitest.config.ts");

    expect(filePaths).toContain("lefthook.yml");
    expect(filePaths).toContain(".oxfmtrc.json");
    expect(filePaths).toContain(".oxlintrc.json");
    expect(filePaths).not.toContain(".husky/commit-msg");
    expect(filePaths).not.toContain("commitlint.config.js");
    expect(packageJson.devDependencies).toMatchObject({
      "@vitest/coverage-v8": expect.any(String),
      lefthook: expect.any(String),
      oxfmt: expect.any(String),
      oxlint: expect.any(String),
    });
    expect(packageJson.dependencies).toMatchObject({
      zod: "^4.4.3",
    });
    expect(packageJson.devDependencies).not.toHaveProperty("@vitest/coverage-istanbul");
    expect(packageJson.devDependencies).not.toHaveProperty("@commitlint/cli");
    expect(packageJson.devDependencies).not.toHaveProperty("husky");
    expect(packageJson.scripts.lint).toContain("oxlint");
    expect(packageJson.scripts.format).toContain("oxfmt");
    expect(vitestConfig.content).toContain(`provider: "v8"`);
  });

  it("emits ignore patterns for local artifacts and environment files", () => {
    const gitignore = findGeneratedFile(buildProjectFiles(baseConfig), ".gitignore");

    expect(gitignore.content).toContain("*.tsbuildinfo");
    expect(gitignore.content).toContain("*.tgz");
    expect(gitignore.content).toContain(".env");
    expect(gitignore.content).toContain(".env.*");
    expect(gitignore.content).toContain("!.env.example");
  });

  it("emits publint-compatible export condition order", () => {
    const packageJson = parseGeneratedJson<GeneratedPackageJson>(
      buildProjectFiles(baseConfig),
      "package.json",
    );

    expect(Object.keys(packageJson.exports["."])).toEqual(["types", "default"]);
  });

  it.each<PackageManager>(["npm", "pnpm", "yarn"])(
    "renders package-manager commands for %s",
    (packageManager) => {
      const files = buildProjectFiles({
        ...baseConfig,
        packageManager,
      });
      const filePaths = files.map((file) => file.path);
      const ciWorkflow = findGeneratedFile(files, ".github/workflows/ci.yml");
      const lefthook = findGeneratedFile(files, "lefthook.yml");

      if (packageManager === "npm") {
        expect(ciWorkflow.content).toContain("npm ci");
        expect(lefthook.content).toContain("npm run lint");
        expect(filePaths).not.toContain("pnpm-workspace.yaml");
      }

      if (packageManager === "pnpm") {
        expect(ciWorkflow.content).toContain("pnpm install --frozen-lockfile");
        expect(lefthook.content).toContain("pnpm run lint");
        expect(findGeneratedFile(files, "pnpm-workspace.yaml").content).toContain("lefthook: true");
        expect(findGeneratedFile(files, "pnpm-workspace.yaml").content).toContain('  - "."');
      }

      if (packageManager === "yarn") {
        expect(ciWorkflow.content).toContain("yarn install --frozen-lockfile");
        expect(ciWorkflow.content).toContain("yarn audit --groups dependencies");
        expect(lefthook.content).toContain("yarn run lint");
        expect(filePaths).not.toContain("pnpm-workspace.yaml");
      }
    },
  );

  it("adds CLI files and binary metadata when requested", () => {
    const files = buildProjectFiles({
      ...baseConfig,
      includeCli: true,
      packageManager: "npm",
      projectName: "@scope/example-cli",
    });
    const packageJsonFile = findGeneratedFile(files, "package.json");

    expect(files.map((file) => file.path)).toContain("source/cli.ts");
    expect(packageJsonFile.content).toContain(
      `"${getBinName("@scope/example-cli")}": "dist/cli.js"`,
    );
    expect(packageJsonFile.content).toContain(`"meow": "^14.0.0"`);
    expect(packageJsonFile.content).not.toContain(`"packageManager"`);
  });

  it("skips GitHub workflows when no repository URL is provided", () => {
    const filePaths = buildProjectFiles({
      ...baseConfig,
      githubRepoUrl: "",
    }).map((file) => file.path);

    expect(filePaths).not.toContain(".github/workflows/ci.yml");
    expect(filePaths).not.toContain(".github/workflows/semantic-pr.yml");
  });

  it("renders parseable JSON and JSONC config files", () => {
    const files = buildProjectFiles(baseConfig);

    expect(() => parseGeneratedJson(files, "package.json")).not.toThrow();
    expect(() => parseGeneratedJson(files, ".oxfmtrc.json")).not.toThrow();
    expect(() => parseGeneratedJson(files, ".oxlintrc.json")).not.toThrow();
    expect(() => parseGeneratedJson(files, "tsconfig.json")).not.toThrow();
    expect(() => parseGeneratedJson(files, "tsconfig.build.json")).not.toThrow();
    expect(() => parseGeneratedJsonc(files, "biome.jsonc")).not.toThrow();
  });

  it.each<LicenseName>(["MIT", "ISC", "Apache-2.0", "UNLICENSED"])(
    "renders %s license text",
    (license) => {
      const licenseFile = findGeneratedFile(
        buildProjectFiles({
          ...baseConfig,
          license,
        }),
        "LICENSE",
      );

      expect(licenseFile.content).toContain(
        license === "UNLICENSED" ? "All rights reserved." : license.split("-")[0],
      );
      expect(licenseFile.content).toContain("Harold Martin");
    },
  );
});

describe("renderBiomeJsonc", () => {
  it("renders parseable config and toggles the CLI override", () => {
    const withoutCli = renderBiomeJsonc(false);
    const withCli = renderBiomeJsonc(true);

    expect(() => parseJsonc("biome.jsonc", withoutCli)).not.toThrow();
    expect(() => parseJsonc("biome.jsonc", withCli)).not.toThrow();
    expect(withoutCli).not.toContain("source/cli.ts");
    expect(withCli).toContain("source/cli.ts");
  });
});

describe("scaffoldProject", () => {
  it("writes the generated files to disk", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "create-ts-lib-"));

    await scaffoldProject(
      {
        ...baseConfig,
        githubRepoUrl: "",
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

const findGeneratedFile = (files: ReturnType<typeof buildProjectFiles>, path: string) => {
  const file = files.find((generatedFile) => generatedFile.path === path);

  if (!file) {
    throw new Error(`Expected generated file ${path}`);
  }

  return file;
};

const parseGeneratedJson = <JsonValue = unknown>(
  files: ReturnType<typeof buildProjectFiles>,
  path: string,
): JsonValue => JSON.parse(findGeneratedFile(files, path).content) as JsonValue;

const parseGeneratedJsonc = (files: ReturnType<typeof buildProjectFiles>, path: string) =>
  parseJsonc(path, findGeneratedFile(files, path).content);

const parseJsonc = (path: string, content: string): unknown => {
  const parseResult = parseConfigFileTextToJson(path, content);

  if (parseResult.error) {
    throw new Error(flattenDiagnosticMessageText(parseResult.error.messageText, "\n"));
  }

  return parseResult.config;
};
