import { access, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { flattenDiagnosticMessageText, parseConfigFileTextToJson } from "typescript";
import { describe, expect, it } from "vitest";

import {
  initializeGitRepositoryIfNeeded,
  runPackageManagerCommand,
  scaffoldProject,
} from "../source/scaffold.js";
import { renderBiomeJsonc } from "../source/templates/biome.js";
import {
  buildProjectFiles,
  getBinName,
  type LicenseName,
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
  repository?: {
    type: string;
    url: string;
  };
  scripts: {
    attw: string;
    check: string;
    format: string;
    lint: string;
    prepublishOnly: string;
    publint: string;
    "release:check": string;
  } & Record<string, string>;
}

interface GeneratedOxfmtConfig {
  ignorePatterns: string[];
}

describe("buildProjectFiles", () => {
  it("includes GitHub CI and release workflows without release-please files", () => {
    const files = buildProjectFiles(baseConfig);
    const filePaths = files.map((file) => file.path);
    const ciWorkflow = files.find((file) => file.path === ".github/workflows/ci.yml");
    const releaseWorkflow = files.find((file) => file.path === ".github/workflows/release.yml");

    expect(filePaths).toContain(".github/workflows/ci.yml");
    expect(filePaths).toContain(".github/workflows/release.yml");
    expect(filePaths).not.toContain(".github/workflows/release-please.yml");
    expect(filePaths).not.toContain("release-please-config.json");
    expect(filePaths).not.toContain(".release-please-manifest.json");
    expect(ciWorkflow?.content).toContain("version: 11.5.2");
    expect(ciWorkflow?.content).toContain("persist-credentials: false");
    expect(ciWorkflow?.content).toContain("pnpm exec publint --pack pnpm");
    expect(ciWorkflow?.content).toContain("pnpm run lint");
    expect(ciWorkflow?.content).not.toContain("setup-biome");
    expect(ciWorkflow?.content).not.toContain("biome ci");
    expect(releaseWorkflow?.content).toContain("types: [published]");
    expect(releaseWorkflow?.content).toContain("id-token: write");
    expect(releaseWorkflow?.content).toContain("ref: $" + "{{ github.event.release.tag_name }}");
    expect(releaseWorkflow?.content).toContain("pnpm run release:check");
    expect(releaseWorkflow?.content).toContain('TAG="next"');
    expect(releaseWorkflow?.content).toContain(
      'npm publish --tag "$TAG" --access public --provenance',
    );
  });

  it("emits Lefthook and Oxc tooling", () => {
    const files = buildProjectFiles(baseConfig);
    const filePaths = files.map((file) => file.path);
    const oxfmtConfig = parseGeneratedJson<GeneratedOxfmtConfig>(files, ".oxfmtrc.json");
    const packageJson = parseGeneratedJson<GeneratedPackageJson>(files, "package.json");
    const vitestConfig = findGeneratedFile(files, "vitest.config.ts");

    expect(filePaths).toContain("lefthook.yml");
    expect(filePaths).toContain(".oxfmtrc.json");
    expect(filePaths).toContain(".oxlintrc.json");
    expect(packageJson.devDependencies).toMatchObject({
      "@arethetypeswrong/cli": expect.any(String),
      "@vitest/coverage-v8": expect.any(String),
      lefthook: expect.any(String),
      oxfmt: expect.any(String),
      oxlint: expect.any(String),
      publint: expect.any(String),
    });
    expect(packageJson.dependencies).toMatchObject({
      zod: "^4.4.3",
    });
    expect(packageJson.devDependencies).not.toHaveProperty("@vitest/coverage-istanbul");
    expect(packageJson.devDependencies).not.toHaveProperty("husky");
    expect(packageJson.scripts.check).toBe("pnpm run lint && pnpm run typecheck && pnpm run test");
    expect(packageJson.scripts.prepublishOnly).toContain("pnpm run check");
    expect(packageJson.scripts.publint).toBe("publint --pack pnpm");
    expect(packageJson.scripts.attw).toBe("attw --pack . --profile esm-only");
    expect(packageJson.scripts["release:check"]).toContain(
      "npm publish --dry-run --ignore-scripts",
    );
    expect(packageJson.scripts.lint).toContain("oxlint");
    expect(packageJson.scripts.format).toContain("oxfmt");
    expect(oxfmtConfig.ignorePatterns).toEqual(["*.json", "**/*.json"]);
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

  it("renders pnpm package-manager commands", () => {
    const files = buildProjectFiles(baseConfig);
    const ciWorkflow = findGeneratedFile(files, ".github/workflows/ci.yml");
    const lefthook = findGeneratedFile(files, "lefthook.yml");
    const pnpmWorkspaceLines = findGeneratedFile(files, "pnpm-workspace.yaml")
      .content.split(/\r?\n/u)
      .map((line) => line.trim());

    expect(ciWorkflow.content).toContain("pnpm install --frozen-lockfile");
    expect(lefthook.content).toContain("pnpm run lint");
    expect(pnpmWorkspaceLines).toContain("lefthook: true");
    expect(pnpmWorkspaceLines).toContain('- "."');
  });

  it("generates a README with install, usage, license, and optional CLI docs", () => {
    const files = buildProjectFiles(baseConfig);
    const readme = findGeneratedFile(files, "README.md");
    const cliReadme = findGeneratedFile(
      buildProjectFiles({
        ...baseConfig,
        includeCli: true,
        projectName: "@scope/example-cli",
      }),
      "README.md",
    );

    expect(readme.content).toContain("# `example-lib`");
    expect(readme.content).toContain(
      "[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)",
    );
    expect(readme.content).toContain("A test library");
    expect(readme.content).toContain("pnpm add example-lib");
    expect(readme.content).toContain('import { formatValue } from "example-lib";');
    expect(readme.content).toContain("MIT - Harold Martin.");
    expect(readme.content).not.toContain("## CLI");
    expect(cliReadme.content).toContain("## CLI");
    expect(cliReadme.content).toContain("example-cli --help");
  });

  it("adds CLI files and binary metadata when requested", () => {
    const files = buildProjectFiles({
      ...baseConfig,
      includeCli: true,
      projectName: "@scope/example-cli",
    });
    const packageJsonFile = findGeneratedFile(files, "package.json");
    const packageJson = parseGeneratedJson<GeneratedPackageJson>(files, "package.json");

    expect(files.map((file) => file.path)).toContain("source/cli.ts");
    expect(packageJsonFile.content).toContain(
      `"${getBinName("@scope/example-cli")}": "dist/cli.js"`,
    );
    expect(packageJsonFile.content).toContain(`"meow": "^14.0.0"`);
    expect(packageJsonFile.content).not.toContain(`"packageManager"`);
    expect(packageJson.repository).toEqual({
      type: "git",
      url: "git+https://github.com/hbmartin/example-lib.git",
    });
  });

  it("skips GitHub workflows when no repository URL is provided", () => {
    const filePaths = buildProjectFiles({
      ...baseConfig,
      githubRepoUrl: "",
    }).map((file) => file.path);

    expect(filePaths).not.toContain(".github/workflows/ci.yml");
    expect(filePaths).not.toContain(".github/workflows/release.yml");
  });

  it.each(["npm", "yarn"] as const)("skips GitHub workflows for %s projects", (packageManager) => {
    const filePaths = buildProjectFiles({
      ...baseConfig,
      packageManager,
    }).map((file) => file.path);

    expect(filePaths).not.toContain(".github/workflows/ci.yml");
    expect(filePaths).not.toContain(".github/workflows/release.yml");
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

  it("writes into an existing empty target directory", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "create-ts-lib-empty-"));
    const targetDirectory = join(tempDirectory, "example-lib");
    await mkdir(targetDirectory);

    await scaffoldProject(
      {
        ...baseConfig,
        githubRepoUrl: "",
      },
      {
        postScaffold: false,
        targetDirectory,
      },
    );

    await expect(readFile(join(targetDirectory, "package.json"), "utf8")).resolves.toContain(
      `"name": "example-lib"`,
    );
  });

  it("rejects non-empty target directories unless force is enabled", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "create-ts-lib-non-empty-"));
    const targetDirectory = join(tempDirectory, "example-lib");
    await mkdir(targetDirectory);
    await writeFile(join(targetDirectory, "package.json"), '{"name":"existing"}\n', "utf8");

    await expect(
      scaffoldProject(baseConfig, {
        postScaffold: false,
        targetDirectory,
      }),
    ).rejects.toThrow("Target directory is not empty");

    await expect(readFile(join(targetDirectory, "package.json"), "utf8")).resolves.toBe(
      '{"name":"existing"}\n',
    );
  });

  it("allows overwriting generated paths in non-empty targets when force is enabled", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "create-ts-lib-force-"));
    const targetDirectory = join(tempDirectory, "example-lib");
    await mkdir(targetDirectory);
    await writeFile(join(targetDirectory, "package.json"), '{"name":"existing"}\n', "utf8");

    await scaffoldProject(baseConfig, {
      force: true,
      postScaffold: false,
      targetDirectory,
    });

    await expect(readFile(join(targetDirectory, "package.json"), "utf8")).resolves.toContain(
      `"name": "example-lib"`,
    );
  });

  it("rejects invalid project names through the programmatic API", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "create-ts-lib-invalid-name-"));

    await expect(
      scaffoldProject(
        {
          ...baseConfig,
          projectName: "@scope/",
        },
        {
          postScaffold: false,
          targetDirectory: join(tempDirectory, "example-lib"),
        },
      ),
    ).rejects.toThrow('Invalid project name "@scope/"');
  });
});

describe("initializeGitRepositoryIfNeeded", () => {
  it("initializes git when the target is not already inside a repository", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "create-ts-lib-git-"));

    await initializeGitRepositoryIfNeeded(tempDirectory);

    await expect(access(join(tempDirectory, ".git"))).resolves.toBeUndefined();
  });
});

describe("runPackageManagerCommand", () => {
  it("resolves when the package manager exits successfully", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "create-ts-lib-pm-"));
    await writeFile(
      join(tempDirectory, "package.json"),
      JSON.stringify({ scripts: { ok: 'node -e ""' } }),
      "utf8",
    );

    await expect(
      runPackageManagerCommand("pnpm", ["--silent", "run", "ok"], tempDirectory),
    ).resolves.toBeUndefined();
  });

  it("rejects when the package manager exits with a failure", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "create-ts-lib-pm-"));
    await writeFile(join(tempDirectory, "package.json"), JSON.stringify({ scripts: {} }), "utf8");

    await expect(
      runPackageManagerCommand("pnpm", ["--silent", "run", "missing"], tempDirectory),
    ).rejects.toThrow("pnpm --silent run missing exited with code");
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
