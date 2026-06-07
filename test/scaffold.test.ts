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
  tsgoProbeCommand,
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
  bugs?: {
    url: string;
  };
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  exports: {
    ".": Record<string, string>;
  };
  homepage?: string;
  repository?: {
    type: string;
    url: string;
  };
  scripts: {
    attw: string;
    check: string;
    "deps:lint": string;
    format: string;
    lint: string;
    prepublishOnly: string;
    publint: string;
    "release:check": string;
    "security:lint": string;
    "size:report": string;
    test: string;
    "test:coverage": string;
    "types:lint": string;
    "verify:artifacts": string;
    "verify:package": string;
  } & Record<string, string>;
}

interface GeneratedOxfmtConfig {
  ignorePatterns: string[];
}

interface GeneratedOxlintConfig {
  ignorePatterns: string[];
}

interface GeneratedBiomeConfig {
  files: {
    includes: string[];
  };
}

describe("buildProjectFiles", () => {
  it("includes GitHub CI and release workflows without release-please files", () => {
    const files = buildProjectFiles(baseConfig);
    const filePaths = files.map((file) => file.path);
    const ciWorkflow = files.find((file) => file.path === ".github/workflows/ci.yml");
    const releaseWorkflow = files.find((file) => file.path === ".github/workflows/release.yml");
    const ciWorkflowContent = ciWorkflow?.content ?? "";

    expect(filePaths).toContain(".github/workflows/ci.yml");
    expect(filePaths).toContain(".github/workflows/release.yml");
    expect(filePaths).not.toContain(".github/workflows/release-please.yml");
    expect(filePaths).not.toContain("release-please-config.json");
    expect(filePaths).not.toContain(".release-please-manifest.json");
    expect(ciWorkflow?.content).toContain("version: 11.5.2");
    expect(ciWorkflow?.content).toContain("persist-credentials: false");
    expect(ciWorkflow?.content).toContain(
      "astral-sh/setup-uv@fac544c07dec837d0ccb6301d7b5580bf5edae39 # v8.2.0",
    );
    expect(ciWorkflow?.content).toContain("enable-cache: true");
    expect(ciWorkflow?.content).toContain('SECURITY_LINT_FORCE_UVX: "1"');
    expect(ciWorkflow?.content).toContain("pnpm run publint");
    expect(ciWorkflow?.content).toContain("pnpm run check");
    expect(ciWorkflowContent).toContain("name: TypeScript 7 compatibility probe");
    expect(ciWorkflowContent).toContain(tsgoProbeCommand);
    expect(ciWorkflowContent.indexOf("pnpm run check")).toBeLessThan(
      ciWorkflowContent.indexOf(tsgoProbeCommand),
    );
    expect(ciWorkflowContent.indexOf(tsgoProbeCommand)).toBeLessThan(
      ciWorkflowContent.indexOf("pnpm run build"),
    );
    expect(ciWorkflow?.content).not.toContain("python3 -m pip");
    expect(ciWorkflow?.content).not.toContain("setup-biome");
    expect(ciWorkflow?.content).not.toContain("biome ci");
    expect(releaseWorkflow?.content).toContain("types: [published]");
    expect(releaseWorkflow?.content).toContain("id-token: write");
    expect(releaseWorkflow?.content).toContain("ref: $" + "{{ github.event.release.tag_name }}");
    expect(releaseWorkflow?.content).toContain("version: 11.5.2");
    expect(releaseWorkflow?.content).toContain("node-version: '22.x'");
    expect(releaseWorkflow?.content).toContain(
      "astral-sh/setup-uv@fac544c07dec837d0ccb6301d7b5580bf5edae39 # v8.2.0",
    );
    expect(releaseWorkflow?.content).toContain("enable-cache: true");
    expect(releaseWorkflow?.content).toContain('SECURITY_LINT_FORCE_UVX: "1"');
    expect(releaseWorkflow?.content).not.toContain("python3 -m pip");
    expect(releaseWorkflow?.content).toContain("pnpm run release:check");
    expect(releaseWorkflow?.content).toContain("pnpm run size:report");
    expect(releaseWorkflow?.content).toContain('TAG="next"');
    expect(releaseWorkflow?.content).toContain(
      'npm publish --tag "$TAG" --access public --provenance',
    );
  });

  it("emits Lefthook and Oxc tooling", () => {
    const files = buildProjectFiles(baseConfig);
    const filePaths = files.map((file) => file.path);
    const agents = findGeneratedFile(files, "AGENTS.md");
    const biomeFile = findGeneratedFile(files, "biome.jsonc");
    const biomeConfig = parseGeneratedJsonc(files, "biome.jsonc") as GeneratedBiomeConfig;
    const dependencyCruiser = findGeneratedFile(files, ".dependency-cruiser.cjs");
    const oxfmtConfig = parseGeneratedJson<GeneratedOxfmtConfig>(files, ".oxfmtrc.json");
    const oxlintConfig = parseGeneratedJson<GeneratedOxlintConfig>(files, ".oxlintrc.json");
    const packageJson = parseGeneratedJson<GeneratedPackageJson>(files, "package.json");
    const semgrep = findGeneratedFile(files, "semgrep.yml");
    const securityLint = findGeneratedFile(files, "scripts/security-lint.mjs");
    const vitestConfig = findGeneratedFile(files, "vitest.config.ts");

    expect(filePaths).toContain("AGENTS.md");
    expect(filePaths).toContain(".dependency-cruiser.cjs");
    expect(filePaths).toContain("lefthook.yml");
    expect(filePaths).toContain(".oxfmtrc.json");
    expect(filePaths).toContain(".oxlintrc.json");
    expect(filePaths).toContain("semgrep.yml");
    expect(filePaths).toContain("scripts/security-lint.mjs");
    expect(packageJson.devDependencies).toMatchObject({
      "@arethetypeswrong/cli": expect.any(String),
      "@vitest/coverage-v8": expect.any(String),
      "dependency-cruiser": expect.any(String),
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
    expect(packageJson.devDependencies).not.toHaveProperty("semgrep");
    expect(packageJson.devDependencies).not.toHaveProperty("@typescript/native-preview");
    expect(Object.keys(packageJson.scripts)).not.toContain("typecheck:tsgo");
    expect(Object.values(packageJson.scripts).some((script) => script.includes("tsgo"))).toBe(
      false,
    );
    expect(packageJson.scripts.check).toBe(
      "pnpm run lint && pnpm run typecheck && pnpm run deps:lint && pnpm run security:lint && pnpm run test:coverage",
    );
    expect(packageJson.scripts["deps:lint"]).toBe(
      "depcruise --config .dependency-cruiser.cjs source test",
    );
    expect(packageJson.scripts.prepublishOnly).toContain("pnpm run check");
    expect(packageJson.scripts.prepublishOnly).toContain("pnpm run verify:artifacts");
    expect(packageJson.scripts.prepublishOnly).toContain("pnpm run types:lint");
    expect(packageJson.scripts.publint).toBe("publint --pack pnpm");
    expect(packageJson.scripts.attw).toBe("attw --pack . --profile esm-only");
    expect(packageJson.scripts["release:check"]).toContain("pnpm run verify:package");
    expect(packageJson.scripts["security:lint"]).toBe("node scripts/security-lint.mjs");
    expect(packageJson.scripts["size:report"]).toBe("npm pack --dry-run --json");
    expect(packageJson.scripts.test).toBe("vitest run");
    expect(packageJson.scripts["test:coverage"]).toBe("vitest run --coverage");
    expect(packageJson.scripts["types:lint"]).toBe("attw --pack . --profile esm-only");
    expect(packageJson.scripts["verify:artifacts"]).toContain("node -e");
    expect(packageJson.scripts["verify:artifacts"]).toContain("dist/index.js");
    expect(packageJson.scripts["verify:artifacts"]).not.toContain("dist/cli.js");
    expect(packageJson.scripts["verify:package"]).toBe("npm publish --dry-run --ignore-scripts");
    expect(packageJson.scripts.lint).toContain("oxlint");
    expect(packageJson.scripts.format).toContain("oxfmt");
    expect(agents.content).toContain("Guidance for Codex and other coding agents");
    expect(agents.content).toContain("Before handoff, run `pnpm run release:check`");
    expect(agents.content).toContain("uvx semgrep@1.165.0");
    expect(dependencyCruiser.content).toContain("source-not-to-test");
    expect(dependencyCruiser.content).toContain("source-not-to-dev-dependencies");
    expect(biomeFile.content).toContain("JSON, JSONC, and YAML stay out of Biome");
    expect(biomeConfig.files.includes).toEqual(
      expect.arrayContaining(["!*.jsonc", "!**/*.jsonc", "!*.yml", "!**/*.yml"]),
    );
    expect(oxfmtConfig.ignorePatterns).toEqual([
      "*.json",
      "**/*.json",
      "*.jsonc",
      "**/*.jsonc",
      "*.yml",
      "**/*.yml",
    ]);
    expect(oxlintConfig.ignorePatterns).toEqual(["*.jsonc", "**/*.jsonc", "*.yml", "**/*.yml"]);
    expect(semgrep.content).toContain("no-eval-like-execution");
    expect(semgrep.content).toContain("no-child-process-exec");
    expect(semgrep.content).toContain("no-shell-true-process");
    expect(semgrep.content).toContain("metavariable-regex");
    expect(semgrep.content).toContain(
      "^(spawn|spawnSync|execFile|execFileSync|execa|execaSync|execaCommand|execaCommandSync)$",
    );
    expect(semgrep.content).toContain("no-weak-crypto-hash");
    expect(semgrep.content).toContain("no-math-random-security-sensitive");
    expect(securityLint.content).toContain('semgrepVersion = "1.165.0"');
    expect(securityLint.content).toContain('runCommand("uvx"');
    expect(securityLint.content).toContain("SECURITY_LINT_FORCE_UVX");
    expect(securityLint.content).toContain("node:child_process");
    expect(securityLint.content).not.toContain("console.");
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
    expect(readme.content).toContain("uvx semgrep@1.165.0");
    expect(readme.content).toContain(
      "[![npm version](https://img.shields.io/npm/v/example-lib.svg)](https://www.npmjs.com/package/example-lib)",
    );
    expect(readme.content).toContain(
      "[![CI](https://github.com/hbmartin/example-lib/actions/workflows/ci.yml/badge.svg)](https://github.com/hbmartin/example-lib/actions/workflows/ci.yml)",
    );
    expect(readme.content).toContain("See [`AGENTS.md`](AGENTS.md)");
    expect(readme.content).toContain("[MIT](LICENSE) © Harold Martin.");
    expect(readme.content).not.toContain("## CLI");
    expect(cliReadme.content).toContain("## CLI");
    expect(cliReadme.content).toContain("example-cli --help");
  });

  it("renders author fallbacks in generated README license text", () => {
    const emailOnlyReadme = findGeneratedFile(
      buildProjectFiles({
        ...baseConfig,
        author: "<harold@example.com>",
      }),
      "README.md",
    );
    const anonymousReadme = findGeneratedFile(
      buildProjectFiles({
        ...baseConfig,
        author: "",
      }),
      "README.md",
    );

    expect(emailOnlyReadme.content).toContain("[MIT](LICENSE) © harold@example.com.");
    expect(emailOnlyReadme.content).not.toContain("© <harold@example.com>.");
    expect(anonymousReadme.content).toContain("[MIT](LICENSE) © Unknown Author.");
  });

  it.each([
    ["SSH", "git@github.com:hbmartin/example-lib.git"],
    ["git+https", "git+https://github.com/hbmartin/example-lib.git"],
  ])(
    "normalizes %s GitHub URLs in generated metadata and README badges",
    (_label, githubRepoUrl) => {
      const files = buildProjectFiles({
        ...baseConfig,
        githubRepoUrl,
      });
      const packageJson = parseGeneratedJson<GeneratedPackageJson>(files, "package.json");
      const readme = findGeneratedFile(files, "README.md");

      expect(packageJson.repository).toEqual({
        type: "git",
        url: "git+https://github.com/hbmartin/example-lib.git",
      });
      expect(packageJson.homepage).toBe("https://github.com/hbmartin/example-lib#readme");
      expect(packageJson.bugs?.url).toBe("https://github.com/hbmartin/example-lib/issues");
      expect(readme.content).toContain(
        "[![CI](https://github.com/hbmartin/example-lib/actions/workflows/ci.yml/badge.svg)](https://github.com/hbmartin/example-lib/actions/workflows/ci.yml)",
      );
    },
  );

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
    expect(packageJson.scripts["verify:artifacts"]).toContain("dist/cli.js");
  });

  it("skips GitHub workflows when no repository URL is provided", () => {
    const files = buildProjectFiles({
      ...baseConfig,
      githubRepoUrl: "",
    });
    const filePaths = files.map((file) => file.path);

    expect(filePaths).not.toContain(".github/workflows/ci.yml");
    expect(filePaths).not.toContain(".github/workflows/release.yml");
    expect(findGeneratedFile(files, "README.md").content).not.toContain(
      "actions/workflows/ci.yml/badge.svg",
    );
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
