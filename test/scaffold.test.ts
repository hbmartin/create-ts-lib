import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type ParseError, parse as parseJsoncText, printParseErrorCode } from "jsonc-parser";
import { describe, expect, it } from "vitest";

import generatorPackageJson from "../package.json" with { type: "json" };
import { ciNodeVersions, nodeTargetOptions } from "../source/node-target.js";
import {
  getPackageManagerExecutable,
  initializeGitRepositoryIfNeeded,
  runPackageManagerCommand,
  scaffoldProject,
} from "../source/scaffold.js";
import { renderBiomeJsonc } from "../source/templates/biome.js";
import { buildCommunityFiles } from "../source/templates/community.js";
import {
  buildProjectFiles,
  defaultScaffoldConfig,
  type GeneratedFile,
  getBinName,
  type LicenseName,
  renderTemplate,
  type ScaffoldConfig,
  type ScaffoldConfigOverrides,
} from "../source/templates/files.js";
import {
  generatedPackageDependencies,
  generatedPackageDevDependencies,
  githubActionRefs,
  nodeTypesVersion,
  nodeTypesVersionByTarget,
  pnpmVersion,
  semgrepVersion,
} from "../source/templates/generated-versions.js";
import { createTempDirectory } from "./helpers/temp-directory.js";

const baseConfig: ScaffoldConfig = {
  author: "Harold Martin <harold@example.com>",
  bundler: "tsc",
  copyrightYear: "2026",
  description: "A test library",
  githubRepoUrl: "https://github.com/hbmartin/example-lib",
  includeCli: false,
  includeCodecov: true,
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

const forbiddenReleasePleaseFilePaths = [
  ".github/workflows/release-please.yml",
  "release-please-config.json",
  ".release-please-manifest.json",
  "commitlint.config.js",
  "commitlint.config.cjs",
  "commitlint.config.mjs",
];

const forbiddenReleasePleaseContent = [
  "@commitlint/cli",
  "@commitlint/config-conventional",
  "commitlint",
  "release-please",
];

const generatorDependencies: Record<string, string> = generatorPackageJson.dependencies;
const generatorDevDependencies: Record<string, string> = generatorPackageJson.devDependencies;

const readGeneratorSpecifier = (section: Record<string, string>, packageName: string): string => {
  const specifier = section[packageName];
  if (specifier === undefined) {
    throw new Error(`Expected generator package.json to include ${packageName}`);
  }

  return specifier;
};

interface GeneratedPackageJson {
  bugs?: {
    url: string;
  };
  dependencies: Record<string, string> & {
    zod?: string;
  };
  devDependencies: Record<string, string> & {
    jsr?: string;
    lefthook?: string;
    tsdown?: string;
  };
  engines: {
    node: string;
  };
  exports: {
    ".": Record<string, string>;
  };
  homepage?: string;
  overrides?: Record<string, string>;
  packageManager?: string;
  pnpm?: {
    overrides: Record<string, string>;
  };
  repository?: {
    type: string;
    url: string;
  };
  resolutions?: Record<string, string>;
  scripts: {
    attw: string;
    build: string;
    check: string;
    "deps:lint": string;
    dev: string;
    format: string;
    lint: string;
    prepare?: string;
    prepublishOnly: string;
    publint: string;
    "release:check": string;
    "security:lint": string;
    "size:report": string;
    test: string;
    "test:coverage": string;
    typecheck: string;
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
  formatter: {
    enabled: boolean;
  };
}

interface GeneratedFallowConfig {
  entry: string[];
  rules: Record<string, string>;
  boundaries: {
    zones: { name: string; patterns: string[] }[];
    rules: { from: string; allow: string[] }[];
  };
}

describe("renderTemplate", () => {
  it("throws when a standalone template placeholder remains unresolved", () => {
    let error: unknown;

    try {
      renderTemplate("agents.md.tmpl");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain("Unresolved template placeholder(s) in agents.md.tmpl:");
    expect(message).toContain("{{PACKAGE_MANAGER}}");
    expect(message).toContain("{{LINT_FORMAT_GUIDANCE}}");
    expect(message).toContain("{{ZOD_GUIDANCE}}");
    expect(message).toContain("{{CLI_GUIDANCE}}");
    expect(message).toContain("{{RUN_PREFIX}}");
    expect(message).toContain("{{NODE_TARGET}}");
  });

  it("allows GitHub Actions expressions in templates", () => {
    const releaseWorkflow = renderTemplate("github/release.yml.tmpl", {
      ACTION_CHECKOUT: githubActionRefs.checkout,
      ACTION_PNPM_SETUP: githubActionRefs.pnpmSetup,
      ACTION_SETUP_NODE: githubActionRefs.setupNode,
      ACTION_SETUP_UV: githubActionRefs.setupUv,
      JSR_PUBLISH_STEP: "",
      NODE_TARGET: "24",
      PNPM_VERSION: pnpmVersion,
    });

    expect(releaseWorkflow).toContain("ref: $" + "{{ github.event.release.tag_name }}");
  });

  it("renders replacement values with dollar tokens literally", () => {
    const agents = renderTemplate("agents.md.tmpl", {
      CLI_GUIDANCE: "",
      LINT_FORMAT_GUIDANCE: "literal $& value",
      NODE_TARGET: "24",
      PACKAGE_MANAGER: "pnpm",
      RUN_PREFIX: "pnpm run",
      ZOD_GUIDANCE: "",
    });

    expect(agents).toContain("literal $& value");
  });
});

describe("Node target pins", () => {
  it("offers only even LTS majors", () => {
    // Node 25 is an odd, short-lived line that never becomes LTS. Offering it
    // would stamp an `engines.node: ">=25"` promise and 25.x types into a
    // package that outlives the runtime. Every other guarantee here hangs off
    // this union, so it is the thing worth pinning down.
    expect<readonly string[]>(nodeTargetOptions).not.toContain("25");
    expect(nodeTargetOptions.every((nodeTarget) => Number(nodeTarget) % 2 === 0)).toBe(true);
    // Guards the guard: an emptied union makes every it.each here vacuous.
    expect(nodeTargetOptions.length).toBeGreaterThan(1);
  });

  it("resolves every pin onto its own target's major", () => {
    const resolvedMajors = nodeTargetOptions.map(
      (nodeTarget) => /^\^(\d+)\./.exec(nodeTypesVersion(nodeTarget))?.[1],
    );

    expect(resolvedMajors).toEqual([...nodeTargetOptions]);
    expect(resolvedMajors).not.toContain("25");
    // The table covers the union exactly: no orphan entry no target can reach,
    // and no target falling through to the lookup's throw.
    expect(Object.keys(nodeTypesVersionByTarget)).toEqual([...nodeTargetOptions]);
  });

  it("lists targets in ascending order", () => {
    // `ciNodeVersions` slices forward from the chosen target to build
    // "floor + next major". Out of order, it would silently emit a matrix that
    // omits the next major, or one testing below the declared floor.
    expect([...nodeTargetOptions]).toEqual(
      [...nodeTargetOptions].sort((left, right) => Number(left) - Number(right)),
    );
  });
});

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
    expect(ciWorkflow?.content).toContain(githubActionRefs.checkout);
    expect(ciWorkflow?.content).toContain(githubActionRefs.pnpmSetup);
    expect(ciWorkflow?.content).toContain(githubActionRefs.setupNode);
    expect(ciWorkflow?.content).toContain(githubActionRefs.codecov);
    expect(ciWorkflow?.content).toContain(`version: ${pnpmVersion}`);
    expect(ciWorkflow?.content).toContain("persist-credentials: false");
    expect(ciWorkflow?.content).toContain("fail-fast: false");
    expect(ciWorkflow?.content).toContain('node-version: ["24", "26"]');
    expect(ciWorkflow?.content).toContain("node-version: $" + "{{ matrix.node-version }}");
    expect(ciWorkflow?.content).toContain(githubActionRefs.setupUv);
    expect(ciWorkflow?.content).toContain("enable-cache: true");
    expect(ciWorkflow?.content).toContain('SECURITY_LINT_FORCE_UVX: "1"');
    expect(ciWorkflow?.content).toContain("pnpm run publint");
    expect(ciWorkflow?.content).toContain("pnpm run check");
    expect(ciWorkflow?.content).toContain("if: matrix.node-version == '24'");
    expect(ciWorkflowContent).not.toContain("TypeScript 7 compatibility probe");
    expect(ciWorkflowContent).not.toContain("tsgo");
    expect(ciWorkflowContent.indexOf("pnpm run check")).toBeLessThan(
      ciWorkflowContent.indexOf("pnpm run build"),
    );
    expect(ciWorkflow?.content).not.toContain("python3 -m pip");
    expect(ciWorkflow?.content).not.toContain("setup-biome");
    expect(ciWorkflow?.content).not.toContain("biome ci");
    expect(releaseWorkflow?.content).toContain(githubActionRefs.checkout);
    expect(releaseWorkflow?.content).toContain(githubActionRefs.pnpmSetup);
    expect(releaseWorkflow?.content).toContain(githubActionRefs.setupNode);
    expect(releaseWorkflow?.content).toContain("types: [published]");
    expect(releaseWorkflow?.content).toContain("id-token: write");
    expect(releaseWorkflow?.content).toContain("ref: $" + "{{ github.event.release.tag_name }}");
    expect(releaseWorkflow?.content).toContain(`version: ${pnpmVersion}`);
    expect(releaseWorkflow?.content).toContain("node-version: '24.x'");
    expect(releaseWorkflow?.content).toContain(githubActionRefs.setupUv);
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

  it.each([
    ["24", '["24", "26"]'],
    ["26", '["26"]'],
  ] as const)("emits the floor-plus-next CI matrix for target %s", (nodeTarget, expectedMatrix) => {
    // Literal expectations on purpose: a test that rebuilds the matrix with the
    // same helper it is checking passes for any helper, broken ones included.
    const ciWorkflow = findGeneratedFile(
      buildProjectFiles({ ...baseConfig, nodeTarget }),
      ".github/workflows/ci.yml",
    );

    expect(ciWorkflow.content).toContain(`node-version: ${expectedMatrix}`);
  });

  it.each(nodeTargetOptions)("wires workflows and prose to target %s", (nodeTarget) => {
    const files = buildProjectFiles({
      ...baseConfig,
      includeCommunityFiles: true,
      nodeTarget,
    });
    const ciWorkflow = findGeneratedFile(files, ".github/workflows/ci.yml");
    const releaseWorkflow = findGeneratedFile(files, ".github/workflows/release.yml");

    // Coverage uploads once per push, from the floor the project declares. A
    // leg naming a major the matrix never runs uploads nothing, silently.
    expect(ciWorkflow.content).toContain(`if: matrix.node-version == '${nodeTarget}'`);
    expect(ciNodeVersions(nodeTarget)[0]).toBe(nodeTarget);
    expect(releaseWorkflow.content).toContain(`node-version: '${nodeTarget}.x'`);
    expect(findGeneratedFile(files, "AGENTS.md").content).toContain(
      `Node ${nodeTarget}+ and ESM-only`,
    );
    expect(findGeneratedFile(files, "CONTRIBUTING.md").content).toContain(
      `Use Node ${nodeTarget} or newer.`,
    );
    expect(ciWorkflow.content).not.toContain('"25"');
  });

  it.each<[string, ScaffoldConfig]>([
    ["pnpm GitHub project", baseConfig],
    ["pnpm project without GitHub workflows", { ...baseConfig, githubRepoUrl: "" }],
    ["pnpm CLI project", { ...baseConfig, includeCli: true }],
    ["pnpm project without Codecov", { ...baseConfig, includeCodecov: false }],
    ["npm project", { ...baseConfig, packageManager: "npm" }],
    ["yarn project", { ...baseConfig, packageManager: "yarn" }],
  ])("does not emit release-please or commitlint artifacts for %s", (_label, config) => {
    expectNoReleasePleaseOrCommitlintArtifacts(buildProjectFiles(config));
  });

  it("omits the Codecov upload step when Codecov is disabled", () => {
    const files = buildProjectFiles({
      ...baseConfig,
      includeCodecov: false,
    });
    const ciWorkflow = findGeneratedFile(files, ".github/workflows/ci.yml");

    expect(ciWorkflow.content).not.toContain("Upload coverage to Codecov");
    expect(ciWorkflow.content).not.toContain(githubActionRefs.codecov);
    expect(ciWorkflow.content).not.toContain("CODECOV_TOKEN");
  });

  it("builds a complete scaffold config with documented defaults", () => {
    const config = defaultScaffoldConfig({
      author: baseConfig.author,
      description: baseConfig.description,
      githubRepoUrl: baseConfig.githubRepoUrl,
      license: baseConfig.license,
      projectName: baseConfig.projectName,
    });
    const files = buildProjectFiles(config);
    const filePaths = files.map((file) => file.path);
    const agents = findGeneratedFile(files, "AGENTS.md");
    const packageJson = parseGeneratedJson<GeneratedPackageJson>(files, "package.json");

    expect(config).toMatchObject({
      includeCli: false,
      includeCodecov: true,
      includeZod: false,
      lintFormatTooling: "oxlint-oxfmt",
      nodeTarget: "24",
      packageManager: "pnpm",
    });
    expect(filePaths).toContain(".oxfmtrc.json");
    expect(filePaths).toContain(".oxlintrc.json");
    expect(filePaths).not.toContain("biome.jsonc");
    expect(packageJson.dependencies).not.toHaveProperty("zod");
    expect(agents.content).toContain("Linting is handled by Oxlint");
    expect(agents.content).not.toContain("Use Zod for external input validation");
    expect(agents.content).toContain("Oxfmt.\n\n## Code Changes");
    expect(agents.content).not.toContain("\n\n\n## Code Changes");
  });

  it("keeps documented defaults when overrides contain undefined values", () => {
    const documentedDefaults = defaultScaffoldConfig();
    const undefinedOverrides = {
      author: undefined,
      description: undefined,
      githubRepoUrl: undefined,
      includeCli: undefined,
      includeCodecov: undefined,
      includeZod: undefined,
      license: undefined,
      lintFormatTooling: undefined,
      packageManager: undefined,
      projectName: undefined,
    } satisfies ScaffoldConfigOverrides;

    expect(defaultScaffoldConfig(undefinedOverrides)).toEqual(documentedDefaults);
  });

  it("uses expected specifiers for generated package versions", () => {
    const packageJson = parseGeneratedJson<GeneratedPackageJson>(
      buildProjectFiles({
        ...baseConfig,
        includeCli: true,
      }),
      "package.json",
    );
    const biomePackageJson = parseGeneratedJson<GeneratedPackageJson>(
      buildProjectFiles({
        ...baseConfig,
        includeCli: true,
        lintFormatTooling: "biome",
      }),
      "package.json",
    );
    const zodPackageJson = parseGeneratedJson<GeneratedPackageJson>(
      buildProjectFiles({
        ...baseConfig,
        includeCli: true,
        includeZod: true,
      }),
      "package.json",
    );
    const expectedNodeTypesVersion = nodeTypesVersion(baseConfig.nodeTarget);

    // Template-only pins: emitted into generated projects but never installed
    // here, because the generator neither imports nor runs them.
    expect(generatorDevDependencies).not.toHaveProperty("meow");
    expect(generatorDevDependencies).not.toHaveProperty("jsr");
    expect(generatorDevDependencies).not.toHaveProperty("tsdown");
    expect(generatedPackageDevDependencies.jsr).toMatch(/^\^/);
    expect(generatedPackageDevDependencies.tsdown).toMatch(/^\^/);
    expect(generatedPackageDependencies).toMatchObject({
      meow: generatedPackageDependencies.meow,
      zod: readGeneratorSpecifier(generatorDependencies, "zod"),
    });
    expect(packageJson.packageManager).toBe(generatorPackageJson.packageManager);
    expect(packageJson.dependencies).toMatchObject({
      meow: generatedPackageDependencies.meow,
    });
    expect(packageJson.dependencies).not.toHaveProperty("zod");
    expect(zodPackageJson.dependencies.zod).toBe(
      readGeneratorSpecifier(generatorDependencies, "zod"),
    );

    for (const dependency of [
      "@arethetypeswrong/cli",
      "@sindresorhus/tsconfig",
      "@vitest/coverage-v8",
      "fallow",
      "lefthook",
      "oxfmt",
      "oxlint",
      "publint",
      "typescript",
      "vitest",
    ]) {
      expect(packageJson.devDependencies[dependency]).toBe(
        readGeneratorSpecifier(generatorDevDependencies, dependency),
      );
    }

    expect(biomePackageJson.devDependencies["@biomejs/biome"]).toBe(
      readGeneratorSpecifier(generatorDevDependencies, "@biomejs/biome"),
    );
    expect(packageJson.devDependencies["@types/node"]).toBe(expectedNodeTypesVersion);
    expect(packageJson.pnpm?.overrides["@types/node"]).toBe(expectedNodeTypesVersion);
  });

  it.each(nodeTargetOptions)(
    "pins @types/node to the same major as the engines.node floor for target %s",
    (nodeTarget) => {
      // Two hand-maintained values with nothing linking them: the `@types/node`
      // pin in generated-versions.ts and the `engines.node` range derived in
      // node-target.ts. Left to drift they produce a project that typechecks
      // against a newer Node than it claims to support, and because a project's
      // typecheck runs once its CI matrix never notices. This is the link.
      const packageJson = parseGeneratedJson<GeneratedPackageJson>(
        buildProjectFiles({ ...baseConfig, nodeTarget }),
        "package.json",
      );

      const engineFloorMajor = /^>=(\d+)$/.exec(packageJson.engines.node)?.[1];
      const nodeTypesMajor = /^\^(\d+)\./.exec(
        packageJson.devDependencies["@types/node"] ?? "",
      )?.[1];

      expect(
        engineFloorMajor,
        `unparseable engines.node: ${packageJson.engines.node}`,
      ).toBeDefined();
      expect(
        nodeTypesMajor,
        `unparseable @types/node: ${packageJson.devDependencies["@types/node"]}`,
      ).toBeDefined();
      // Anchored to the config, not only to each other: two values derived from
      // one wrong source would otherwise agree and pass.
      expect(engineFloorMajor).toBe(nodeTarget);
      expect(nodeTypesMajor).toBe(engineFloorMajor);
    },
  );

  it.each(
    (["npm", "pnpm", "yarn"] as const).flatMap((packageManager) =>
      nodeTargetOptions.map((nodeTarget) => [packageManager, nodeTarget] as const),
    ),
  )(
    "emits @types/node package-manager override fields for %s on target %s",
    (packageManager, nodeTarget) => {
      // The override tables force-pin the whole dependency tree, so they are
      // exactly where a target-keyed pin can silently regress to the other
      // target's major while devDependencies stays right.
      const packageJson = parseGeneratedJson<GeneratedPackageJson>(
        buildProjectFiles({
          ...baseConfig,
          nodeTarget,
          packageManager,
        }),
        "package.json",
      );
      const expectedPin = { "@types/node": nodeTypesVersion(nodeTarget) };

      expect(packageJson.devDependencies["@types/node"]).toBe(expectedPin["@types/node"]);

      switch (packageManager) {
        case "npm":
          expect(packageJson.overrides).toEqual(expectedPin);
          expect(packageJson.pnpm).toBeUndefined();
          expect(packageJson.resolutions).toBeUndefined();
          break;
        case "pnpm":
          expect(packageJson.overrides).toBeUndefined();
          expect(packageJson.pnpm?.overrides).toEqual(expectedPin);
          expect(packageJson.resolutions).toBeUndefined();
          break;
        case "yarn":
          expect(packageJson.overrides).toBeUndefined();
          expect(packageJson.pnpm).toBeUndefined();
          expect(packageJson.resolutions).toEqual(expectedPin);
          break;
      }
    },
  );

  it("emits Lefthook and Oxlint/Oxfmt tooling by default", () => {
    const files = buildProjectFiles(baseConfig);
    const filePaths = files.map((file) => file.path);
    const agents = findGeneratedFile(files, "AGENTS.md");
    const fallowConfig = parseGeneratedJsonc(files, ".fallowrc.jsonc") as GeneratedFallowConfig;
    const oxfmtConfig = parseGeneratedJson<GeneratedOxfmtConfig>(files, ".oxfmtrc.json");
    const oxlintConfig = parseGeneratedJson<GeneratedOxlintConfig>(files, ".oxlintrc.json");
    const packageJson = parseGeneratedJson<GeneratedPackageJson>(files, "package.json");
    const semgrep = findGeneratedFile(files, "semgrep.yml");
    const securityLint = findGeneratedFile(files, "scripts/security-lint.mjs");
    const vitestConfig = findGeneratedFile(files, "vitest.config.ts");

    expect(filePaths).toContain("AGENTS.md");
    expect(filePaths).toContain(".fallowrc.jsonc");
    expect(filePaths).toContain("lefthook.yml");
    expect(filePaths).toContain(".oxfmtrc.json");
    expect(filePaths).toContain(".oxlintrc.json");
    expect(filePaths).not.toContain("biome.jsonc");
    expect(filePaths).toContain("semgrep.yml");
    expect(filePaths).toContain("scripts/security-lint.mjs");
    expect(packageJson.devDependencies).toMatchObject({
      "@arethetypeswrong/cli": expect.any(String),
      "@vitest/coverage-v8": expect.any(String),
      fallow: expect.any(String),
      lefthook: expect.any(String),
      oxfmt: expect.any(String),
      oxlint: expect.any(String),
      publint: expect.any(String),
    });
    expect(packageJson.dependencies).toEqual({});
    expect(
      Object.keys(packageJson.devDependencies).filter((dependency) =>
        dependency.startsWith("@vitest/coverage-"),
      ),
    ).toStrictEqual(["@vitest/coverage-v8"]);
    expect(packageJson.devDependencies).not.toHaveProperty("@commitlint/cli");
    expect(packageJson.devDependencies).not.toHaveProperty("@commitlint/config-conventional");
    expect(packageJson.devDependencies).not.toHaveProperty("@biomejs/biome");
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
    expect(packageJson.scripts["deps:lint"]).toBe("fallow dead-code");
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
    expect(packageJson.packageManager).toBe(`pnpm@${pnpmVersion}`);
    expect(packageJson.scripts.lint).toBe("oxlint --deny-warnings . && oxfmt --check .");
    expect(packageJson.scripts.format).toBe("oxfmt . --write");
    expect(agents.content).toContain("Guidance for Codex and other coding agents");
    expect(agents.content).toContain(
      "Linting is handled by Oxlint, and formatting is handled by Oxfmt.",
    );
    expect(agents.content).toContain(
      ["Linting is handled by Oxlint, and formatting is handled by Oxfmt.", "## Code Changes"].join(
        "\n\n",
      ),
    );
    expect(agents.content).not.toContain("Use Zod");
    expect(agents.content).toContain("Before handoff, run `pnpm run release:check`");
    expect(agents.content).toContain("Use pnpm for all package management and scripts.");
    expect(agents.content).toContain(
      "When public API or CLI behavior changes, update `README.md` and tests.",
    );
    expect(agents.content).toContain(
      "uses Semgrep; install Semgrep or uv if neither is available.",
    );
    expect(agents.content).not.toContain("Keep CLI entry points thin.");
    // The architecture gate that replaced dependency-cruiser: `source/` may not
    // reach into `test/`, and the cycle/dependency rules stay hard errors.
    expect(fallowConfig.rules["boundary-violation"]).toBe("error");
    expect(fallowConfig.rules["circular-dependencies"]).toBe("error");
    expect(fallowConfig.rules["dev-dependencies-in-production"]).toBe("error");
    expect(fallowConfig.rules["unlisted-dependencies"]).toBe("error");
    expect(fallowConfig.rules["unresolved-imports"]).toBe("error");
    expect(fallowConfig.boundaries.rules).toEqual([
      { from: "source", allow: [] },
      { from: "test", allow: ["source"] },
    ]);
    // Entry points must be declared. The package entry resolves into the ignored
    // `dist/`, so without these the source tree is unreachable and every
    // boundary rule above passes vacuously.
    expect(fallowConfig.entry).toEqual(["source/index.ts"]);
    expect(
      (
        parseGeneratedJsonc(
          buildProjectFiles({ ...baseConfig, includeCli: true }),
          ".fallowrc.jsonc",
        ) as GeneratedFallowConfig
      ).entry,
    ).toEqual(["source/index.ts", "source/cli.ts"]);
    // Markdown is ignored so an unformatted README or CHANGELOG cannot block a
    // commit: the generated Lefthook hook runs `oxfmt --check .` over the whole
    // tree, not just the staged files.
    expect(oxfmtConfig.ignorePatterns).toEqual([
      "*.json",
      "**/*.json",
      "*.jsonc",
      "**/*.jsonc",
      "*.yml",
      "**/*.yml",
      "*.md",
      "**/*.md",
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
    expect(securityLint.content).toContain(`semgrepVersion = "${semgrepVersion}"`);
    expect(securityLint.content).toContain('runCommand("uvx"');
    expect(securityLint.content).toContain("SECURITY_LINT_FORCE_UVX");
    expect(securityLint.content).toContain("node:child_process");
    expect(securityLint.content).not.toContain("console.");
    expect(vitestConfig.content).toContain(`provider: "v8"`);
  });

  it("emits Zod dependency and agent guidance when selected", () => {
    const files = buildProjectFiles({
      ...baseConfig,
      includeZod: true,
    });
    const agents = findGeneratedFile(files, "AGENTS.md");
    const packageJson = parseGeneratedJson<GeneratedPackageJson>(files, "package.json");

    expect(packageJson.dependencies).toMatchObject({
      zod: generatedPackageDependencies.zod,
    });
    expect(agents.content).toContain(
      "Use Zod for external input validation and anywhere runtime validation is needed.",
    );
    expect(agents.content).toContain(
      [
        "Use Zod for external input validation and anywhere runtime validation is needed.",
        "## Code Changes",
      ].join("\n\n"),
    );
    expect(agents.content).not.toContain("\n\n\n## Code Changes");
  });

  it("emits Biome tooling when selected", () => {
    const files = buildProjectFiles({
      ...baseConfig,
      lintFormatTooling: "biome",
    });
    const filePaths = files.map((file) => file.path);
    const agents = findGeneratedFile(files, "AGENTS.md");
    const biomeFile = findGeneratedFile(files, "biome.jsonc");
    const biomeConfig = parseGeneratedJsonc(files, "biome.jsonc") as GeneratedBiomeConfig;
    const packageJson = parseGeneratedJson<GeneratedPackageJson>(files, "package.json");

    expect(filePaths).toContain("biome.jsonc");
    expect(filePaths).not.toContain(".oxfmtrc.json");
    expect(filePaths).not.toContain(".oxlintrc.json");
    expect(packageJson.devDependencies).toMatchObject({
      "@biomejs/biome": expect.any(String),
    });
    expect(packageJson.devDependencies).not.toHaveProperty("oxfmt");
    expect(packageJson.devDependencies).not.toHaveProperty("oxlint");
    expect(packageJson.scripts.lint).toBe("biome check --error-on-warnings .");
    expect(packageJson.scripts.format).toBe("biome format --write .");
    expect(agents.content).toContain("Linting and formatting are handled by Biome.");
    expect(biomeFile.content).not.toContain("stay out of Biome");
    expect(biomeConfig.formatter.enabled).toBe(true);
    expect(biomeConfig.files.includes).not.toEqual(
      expect.arrayContaining(["!*.jsonc", "!**/*.jsonc", "!*.yml", "!**/*.yml"]),
    );
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
    expect(readme.content).toContain(`uvx semgrep@${semgrepVersion}`);
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
    ["https trailing slash", "https://github.com/hbmartin/example-lib/"],
    ["git+https", "git+https://github.com/hbmartin/example-lib.git"],
    ["git+ssh", "git+ssh://git@github.com/hbmartin/example-lib.git"],
    ["ssh", "ssh://git@github.com/hbmartin/example-lib.git"],
    ["git", "git://github.com/hbmartin/example-lib.git"],
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
    const cliTest = findGeneratedFile(files, "test/cli.test.ts");

    expect(files.map((file) => file.path)).toContain("source/cli.ts");
    expect(files.map((file) => file.path)).toContain("test/cli.test.ts");
    expect(cliTest.content).toContain(`expect.stringContaining("$ example-cli <input>")`);
    expect(cliTest.content).toContain("flags: {}");
    expect(cliTest.content).toContain("input: []");
    expect(packageJsonFile.content).toContain(
      `"${getBinName("@scope/example-cli")}": "dist/cli.js"`,
    );
    expect(packageJsonFile.content).toContain(`"meow": "${generatedPackageDependencies.meow}"`);
    expect(packageJson.packageManager).toBe(`pnpm@${pnpmVersion}`);
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
    const files = buildProjectFiles({
      ...baseConfig,
      packageManager,
    });
    const filePaths = files.map((file) => file.path);
    const packageJson = parseGeneratedJson<GeneratedPackageJson>(files, "package.json");

    expect(filePaths).not.toContain(".github/workflows/ci.yml");
    expect(filePaths).not.toContain(".github/workflows/release.yml");
    expect(packageJson.packageManager).toBeUndefined();
  });

  it("renders parseable JSON and JSONC config files", () => {
    const files = buildProjectFiles(baseConfig);
    const biomeFiles = buildProjectFiles({
      ...baseConfig,
      lintFormatTooling: "biome",
    });

    expect(() => parseGeneratedJson(files, "package.json")).not.toThrow();
    expect(() => parseGeneratedJson(files, ".oxfmtrc.json")).not.toThrow();
    expect(() => parseGeneratedJson(files, ".oxlintrc.json")).not.toThrow();
    expect(() => parseGeneratedJson(files, "tsconfig.json")).not.toThrow();
    expect(() => parseGeneratedJson(files, "tsconfig.build.json")).not.toThrow();
    expect(() => parseGeneratedJsonc(biomeFiles, "biome.jsonc")).not.toThrow();
    expect(() => parseGeneratedJsonc(files, ".fallowrc.jsonc")).not.toThrow();
  });

  it("emits tsdown build tooling when selected", () => {
    const files = buildProjectFiles({
      ...baseConfig,
      bundler: "tsdown",
      includeCli: true,
    });
    const filePaths = files.map((file) => file.path);
    const packageJson = parseGeneratedJson<GeneratedPackageJson>(files, "package.json");
    const tsdownConfig = findGeneratedFile(files, "tsdown.config.ts");

    expect(filePaths).toContain("tsdown.config.ts");
    expect(filePaths).not.toContain("tsconfig.build.json");
    expect(packageJson.scripts.build).toBe("tsdown");
    expect(packageJson.scripts.dev).toBe("tsdown --watch");
    expect(packageJson.scripts.typecheck).toBe("tsc --noEmit");
    expect(packageJson.devDependencies.tsdown).toBe(generatedPackageDevDependencies.tsdown);
    expect(tsdownConfig.content).toContain('entry: ["./source/index.ts", "./source/cli.ts"]');
    expect(tsdownConfig.content).toContain("dts: true");
  });

  it("emits tsc build tooling by default without a tsdown dependency", () => {
    const files = buildProjectFiles(baseConfig);
    const filePaths = files.map((file) => file.path);
    const packageJson = parseGeneratedJson<GeneratedPackageJson>(files, "package.json");

    expect(filePaths).toContain("tsconfig.build.json");
    expect(filePaths).not.toContain("tsdown.config.ts");
    expect(packageJson.scripts.build).toBe("tsc -p tsconfig.build.json");
    expect(packageJson.devDependencies).not.toHaveProperty("tsdown");
  });

  it("emits JSR manifest, publish script, badge, and release step when selected", () => {
    const files = buildProjectFiles({
      ...baseConfig,
      includeJsr: true,
      projectName: "@scope/example-lib",
    });
    const jsrJson = parseGeneratedJson<{ exports: string; name: string }>(files, "jsr.json");
    const packageJson = parseGeneratedJson<GeneratedPackageJson>(files, "package.json");
    const readme = findGeneratedFile(files, "README.md");
    const releaseWorkflow = findGeneratedFile(files, ".github/workflows/release.yml");

    expect(jsrJson.name).toBe("@scope/example-lib");
    expect(jsrJson.exports).toBe("./source/index.ts");
    expect(packageJson.scripts["jsr:publish"]).toBe("jsr publish");
    expect(packageJson.devDependencies.jsr).toBe(generatedPackageDevDependencies.jsr);
    expect(readme.content).toContain("jsr.io/badges/@scope/example-lib");
    expect(releaseWorkflow.content).toContain("Publish to JSR");
    expect(releaseWorkflow.content).toContain("pnpm run jsr:publish");
  });

  it("omits JSR artifacts by default", () => {
    const files = buildProjectFiles(baseConfig);
    const packageJson = parseGeneratedJson<GeneratedPackageJson>(files, "package.json");
    const releaseWorkflow = findGeneratedFile(files, ".github/workflows/release.yml");

    expect(files.map((file) => file.path)).not.toContain("jsr.json");
    expect(packageJson.scripts).not.toHaveProperty("jsr:publish");
    expect(releaseWorkflow.content).not.toContain("jsr publish");
  });

  it("emits SHA-pinned CodeQL and Scorecard workflows when selected", () => {
    const files = buildProjectFiles({
      ...baseConfig,
      includeSecurityWorkflows: true,
    });
    const codeql = findGeneratedFile(files, ".github/workflows/codeql.yml");
    const scorecard = findGeneratedFile(files, ".github/workflows/scorecard.yml");

    expect(codeql.content).toContain(githubActionRefs.codeqlInit);
    expect(codeql.content).toContain(githubActionRefs.codeqlAnalyze);
    expect(codeql.content).toContain("languages: javascript-typescript");
    expect(scorecard.content).toContain(githubActionRefs.scorecard);
    expect(scorecard.content).toContain(githubActionRefs.codeqlUploadSarif);
    expect(scorecard.content).toContain("persist-credentials: false");
  });

  it.each<[string, ScaffoldConfig]>([
    ["by default", baseConfig],
    [
      "without a GitHub repo URL",
      { ...baseConfig, githubRepoUrl: "", includeSecurityWorkflows: true },
    ],
    ["for npm projects", { ...baseConfig, includeSecurityWorkflows: true, packageManager: "npm" }],
  ])("omits security workflows %s", (_label, config) => {
    const filePaths = buildProjectFiles(config).map((file) => file.path);

    expect(filePaths).not.toContain(".github/workflows/codeql.yml");
    expect(filePaths).not.toContain(".github/workflows/scorecard.yml");
  });

  it("emits a Renovate config whenever a repository URL is provided", () => {
    const withRepo = buildProjectFiles({ ...baseConfig, packageManager: "npm" });
    const withoutRepo = buildProjectFiles({ ...baseConfig, githubRepoUrl: "" });
    const renovate = findGeneratedFile(withRepo, "renovate.json");

    expect(renovate.content).toContain("config:recommended");
    expect(renovate.content).toContain("pinDigests");
    expect(withoutRepo.map((file) => file.path)).not.toContain("renovate.json");
  });

  it("emits VS Code workspace settings matching the lint tooling", () => {
    const oxcFiles = buildProjectFiles(baseConfig);
    const biomeFiles = buildProjectFiles({ ...baseConfig, lintFormatTooling: "biome" });
    const oxcExtensions = parseGeneratedJson<{ recommendations: string[] }>(
      oxcFiles,
      ".vscode/extensions.json",
    );
    const oxcSettings = parseGeneratedJson<Record<string, unknown>>(
      oxcFiles,
      ".vscode/settings.json",
    );
    const biomeExtensions = parseGeneratedJson<{ recommendations: string[] }>(
      biomeFiles,
      ".vscode/extensions.json",
    );
    const biomeSettings = parseGeneratedJson<Record<string, unknown>>(
      biomeFiles,
      ".vscode/settings.json",
    );
    const gitignore = findGeneratedFile(oxcFiles, ".gitignore");

    expect(oxcExtensions.recommendations).toEqual(["oxc.oxc-vscode", "vitest.explorer"]);
    expect(oxcSettings["editor.defaultFormatter"]).toBe("oxc.oxc-vscode");
    expect(oxcSettings["editor.formatOnSave"]).toBe(true);
    expect(biomeExtensions.recommendations).toEqual(["biomejs.biome", "vitest.explorer"]);
    expect(biomeSettings["editor.defaultFormatter"]).toBe("biomejs.biome");
    expect(gitignore.content).toContain("!.vscode/settings.json");
    expect(gitignore.content).toContain("!.vscode/extensions.json");
  });

  it("records scaffold state with a hash for every generated file", () => {
    const files = buildProjectFiles(baseConfig);
    const stateFile = findGeneratedFile(files, ".create-ts-lib.json");
    const state = JSON.parse(stateFile.content) as {
      config: ScaffoldConfig;
      files: Record<string, string>;
      generator: string;
      version: string;
    };

    expect(state.generator).toBe(generatorPackageJson.name);
    expect(state.version).toBe(generatorPackageJson.version);
    expect(state.config).toEqual(baseConfig);
    for (const file of files) {
      if (file.path === ".create-ts-lib.json") {
        continue;
      }

      expect(state.files[file.path]).toMatch(/^[0-9a-f]{64}$/u);
    }
    expect(state.files).not.toHaveProperty(".create-ts-lib.json");
  });

  it("documents npm trusted publishing when release workflows are generated", () => {
    const withWorkflows = findGeneratedFile(buildProjectFiles(baseConfig), "README.md");
    const withoutWorkflows = findGeneratedFile(
      buildProjectFiles({ ...baseConfig, githubRepoUrl: "" }),
      "README.md",
    );

    expect(withWorkflows.content).toContain("## Releasing");
    expect(withWorkflows.content).toContain("https://docs.npmjs.com/trusted-publishers");
    expect(withWorkflows.content).toContain("`hbmartin/example-lib`");
    expect(withoutWorkflows.content).not.toContain("## Releasing");
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

describe("workspace mode", () => {
  const workspaceConfig: ScaffoldConfig = { ...baseConfig, workspaceMode: true };

  const rootOwnedPaths = [
    ".gitignore",
    ".github/workflows/ci.yml",
    ".github/workflows/release.yml",
    ".vscode/extensions.json",
    ".vscode/settings.json",
    "lefthook.yml",
    "pnpm-workspace.yaml",
    "renovate.json",
  ];

  const packageOwnedPaths = [
    ".fallowrc.jsonc",
    "AGENTS.md",
    "LICENSE",
    "README.md",
    "package.json",
    "scripts/security-lint.mjs",
    "semgrep.yml",
    "source/index.ts",
    "test/utils/formatting.test.ts",
    "tsconfig.json",
    "vitest.config.ts",
  ];

  const readPackageJson = (config: ScaffoldConfig): GeneratedPackageJson => {
    const file = buildProjectFiles(config).find((candidate) => candidate.path === "package.json");

    return JSON.parse(file?.content ?? "{}") as GeneratedPackageJson;
  };

  it("omits every root-owned file", () => {
    const paths = buildProjectFiles(workspaceConfig).map((file) => file.path);

    for (const rootOwnedPath of rootOwnedPaths) {
      expect(paths).not.toContain(rootOwnedPath);
    }
  });

  it("keeps every package-owned file", () => {
    const paths = buildProjectFiles(workspaceConfig).map((file) => file.path);

    for (const packageOwnedPath of packageOwnedPaths) {
      expect(paths).toContain(packageOwnedPath);
    }
  });

  it("emits those root-owned files in normal mode", () => {
    const paths = buildProjectFiles(baseConfig).map((file) => file.path);

    for (const rootOwnedPath of rootOwnedPaths) {
      expect(paths).toContain(rootOwnedPath);
    }
  });

  it("leaves the package manager and hook install to the workspace root", () => {
    const packageJson = readPackageJson(workspaceConfig);

    expect(packageJson.packageManager).toBeUndefined();
    expect(packageJson.scripts.prepare).toBeUndefined();
    expect(packageJson.devDependencies.lefthook).toBeUndefined();
  });

  it("still pins the package manager and hooks in normal mode", () => {
    const packageJson = readPackageJson(baseConfig);

    expect(packageJson.packageManager).toBe(`pnpm@${pnpmVersion}`);
    expect(packageJson.scripts.prepare).toBe("lefthook install");
    expect(packageJson.devDependencies.lefthook).toBeDefined();
  });

  it("omits CI badges and release docs the root owns", () => {
    const readme = buildProjectFiles(workspaceConfig).find((file) => file.path === "README.md");

    expect(readme?.content).not.toContain("actions/workflows/ci.yml/badge.svg");
    expect(readme?.content).not.toContain("## Releasing");
  });
});

describe("community-health files", () => {
  const communityPaths = ["CODE_OF_CONDUCT.md", "CONTRIBUTING.md", "SECURITY.md"];

  const findCommunityFile = (config: ScaffoldConfig, path: string): string => {
    const file = buildProjectFiles(config).find((candidate) => candidate.path === path);
    if (!file) {
      throw new Error(`Expected generated file ${path}`);
    }

    return file.content;
  };

  it("omits the files unless includeCommunityFiles is set", () => {
    const paths = buildProjectFiles(baseConfig).map((file) => file.path);

    for (const communityPath of communityPaths) {
      expect(paths).not.toContain(communityPath);
    }
  });

  it("emits all three files when enabled", () => {
    const paths = buildProjectFiles({ ...baseConfig, includeCommunityFiles: true }).map(
      (file) => file.path,
    );

    for (const communityPath of communityPaths) {
      expect(paths).toContain(communityPath);
    }
  });

  it("omits them in workspace mode even when enabled", () => {
    // GitHub only surfaces these at the repository root, so a copy inside
    // packages/<name>/ is a file nothing reads. They are root-owned like the
    // git ignore and the hooks.
    expect(
      buildCommunityFiles({ ...baseConfig, includeCommunityFiles: true, workspaceMode: true }),
    ).toEqual([]);

    const paths = buildProjectFiles({
      ...baseConfig,
      includeCommunityFiles: true,
      workspaceMode: true,
    }).map((file) => file.path);

    for (const communityPath of communityPaths) {
      expect(paths).not.toContain(communityPath);
    }
  });

  it("points SECURITY.md at GitHub private advisory reporting when a repo URL is set", () => {
    const content = findCommunityFile(
      {
        ...baseConfig,
        githubRepoUrl: "git@github.com:hbmartin/example-lib.git",
        includeCommunityFiles: true,
      },
      "SECURITY.md",
    );

    expect(content).toContain("https://github.com/hbmartin/example-lib/security/advisories/new");
  });

  it("falls back to the author email when no repo URL is configured", () => {
    const content = findCommunityFile(
      {
        ...baseConfig,
        author: "Ada Lovelace <ada@example.com>",
        githubRepoUrl: "",
        includeCommunityFiles: true,
      },
      "SECURITY.md",
    );

    expect(content).toContain("privately to ada@example.com");
    expect(content).not.toContain("advisories/new");
  });

  it("keeps the Contributor Covenant placeholder when the author has no email", () => {
    const content = findCommunityFile(
      { ...baseConfig, author: "Ada Lovelace", includeCommunityFiles: true },
      "CODE_OF_CONDUCT.md",
    );

    expect(content).toContain("[INSERT CONTACT METHOD]");
  });

  it("uses the selected package manager in CONTRIBUTING commands", () => {
    const content = findCommunityFile(
      { ...baseConfig, includeCommunityFiles: true, packageManager: "npm" },
      "CONTRIBUTING.md",
    );

    expect(content).toContain("npm install");
    expect(content).toContain("npm run check");
    expect(content).not.toContain("pnpm");
  });

  it.each([
    ["npm", "npm run"],
    ["pnpm", "pnpm run"],
    ["yarn", "yarn run"],
  ] as const)("uses %s commands in AGENTS.md", (packageManager, runPrefix) => {
    const agents = findGeneratedFile(
      buildProjectFiles({ ...baseConfig, packageManager }),
      "AGENTS.md",
    );

    expect(agents.content).toContain(
      `Use ${packageManager} for all package management and scripts.`,
    );
    expect(agents.content).toContain(`Before handoff, run \`${runPrefix} release:check\``);
    if (packageManager !== "pnpm") {
      expect(agents.content).not.toContain("Use pnpm for all package management and scripts.");
    }
  });

  it("includes CLI guidance only when CLI support is enabled", () => {
    const withoutCli = findGeneratedFile(buildProjectFiles(baseConfig), "AGENTS.md");
    const withCli = findGeneratedFile(
      buildProjectFiles({ ...baseConfig, includeCli: true }),
      "AGENTS.md",
    );

    expect(withoutCli.content).not.toContain("Keep CLI entry points thin.");
    expect(withCli.content).toContain("Keep CLI entry points thin.");
  });
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
    const tempDirectory = await createTempDirectory("create-ts-lib-");

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
    const tempDirectory = await createTempDirectory("create-ts-lib-empty-");
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
    const tempDirectory = await createTempDirectory("create-ts-lib-non-empty-");
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
    const tempDirectory = await createTempDirectory("create-ts-lib-force-");
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
    const tempDirectory = await createTempDirectory("create-ts-lib-invalid-name-");

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
    const tempDirectory = await createTempDirectory("create-ts-lib-git-");

    await initializeGitRepositoryIfNeeded(tempDirectory);

    await expect(access(join(tempDirectory, ".git"))).resolves.toBeUndefined();
  });
});

describe("runPackageManagerCommand", () => {
  it("uses Windows command shims without enabling a shell", () => {
    expect(getPackageManagerExecutable("pnpm", "win32")).toBe("pnpm.cmd");
    expect(getPackageManagerExecutable("npm", "win32")).toBe("npm.cmd");
    expect(getPackageManagerExecutable("yarn", "win32")).toBe("yarn.cmd");
  });

  it("uses package manager names directly on non-Windows platforms", () => {
    expect(getPackageManagerExecutable("pnpm", "darwin")).toBe("pnpm");
    expect(getPackageManagerExecutable("npm", "linux")).toBe("npm");
  });

  it("resolves when the package manager exits successfully", async () => {
    const tempDirectory = await createTempDirectory("create-ts-lib-pm-");
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
    const tempDirectory = await createTempDirectory("create-ts-lib-pm-");
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
  const errors: ParseError[] = [];
  const parsed: unknown = parseJsoncText(content, errors, { allowTrailingComma: true });

  if (errors.length > 0) {
    const details = errors
      .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
      .join("\n");

    throw new Error(`Failed to parse ${path} as JSONC:\n${details}`);
  }

  return parsed;
};

const expectNoReleasePleaseOrCommitlintArtifacts = (files: GeneratedFile[]): void => {
  const filePaths = files.map((file) => file.path);
  for (const forbiddenPath of forbiddenReleasePleaseFilePaths) {
    expect(filePaths).not.toContain(forbiddenPath);
  }

  const packageJson = parseGeneratedJson<GeneratedPackageJson>(files, "package.json");
  expectNoCommitlintPackageDependencies(packageJson);
  expect(Object.keys(packageJson.scripts).join("\n")).not.toContain("commitlint");
  expect(Object.values(packageJson.scripts).join("\n")).not.toContain("commitlint");

  const forbiddenMatches = files.flatMap((file) =>
    forbiddenReleasePleaseContent
      .filter((forbiddenContent) => file.content.includes(forbiddenContent))
      .map((forbiddenContent) => `${file.path}: ${forbiddenContent}`),
  );

  expect(forbiddenMatches).toStrictEqual([]);
};

const expectNoCommitlintPackageDependencies = (packageJson: GeneratedPackageJson): void => {
  expect(packageJson.dependencies).not.toHaveProperty("@commitlint/cli");
  expect(packageJson.dependencies).not.toHaveProperty("@commitlint/config-conventional");
  expect(packageJson.devDependencies).not.toHaveProperty("@commitlint/cli");
  expect(packageJson.devDependencies).not.toHaveProperty("@commitlint/config-conventional");
};
