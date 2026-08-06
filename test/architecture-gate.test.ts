import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildProjectFiles, type ScaffoldConfig } from "../source/templates/files.js";

// A gate that reports success while analysing nothing is worse than no gate at
// all, and this project has shipped that bug twice: dependency-cruiser cruised
// zero modules under TypeScript 7 and still exited 0, and the first fallow
// config left `source/` unreachable because the package entry points into the
// ignored `dist/`. Both looked green. These tests run the real generated
// `.fallowrc.jsonc` against fixtures containing deliberate violations, so a
// gate that stops detecting them fails here instead of passing silently.

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const fallowBin = join(repositoryRoot, "node_modules/fallow/bin/fallow");
const gateTestTimeout = 30_000;

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

const readGeneratedFallowConfig = (): string => {
  const configFile = buildProjectFiles(baseConfig).find((file) => file.path === ".fallowrc.jsonc");

  if (!configFile) {
    throw new Error("Scaffolding did not emit .fallowrc.jsonc");
  }

  return configFile.content;
};

const fixturePackageJson = `${JSON.stringify(
  { name: "gate-fixture", version: "0.0.0", private: true, type: "module" },
  undefined,
  2,
)}\n`;
// The dependency rules classify by manifest membership, not by resolvability,
// so these fixtures never install anything: an undeclared bare specifier is
// reported as unlisted rather than unresolved, and a declared-but-absent
// devDependency is still enough to trip the production and unused checks.
const fixtureDependencyName = "gate-fixture-dep";
const fixturePackageJsonWithDevDependency = `${JSON.stringify(
  {
    name: "gate-fixture",
    version: "0.0.0",
    private: true,
    type: "module",
    devDependencies: { [fixtureDependencyName]: "^1.0.0" },
  },
  undefined,
  2,
)}\n`;
const importFixtureDependency = `import { value } from "${fixtureDependencyName}";\nexport const probe = value;\n`;
const cleanSourceIndex = 'export { helper } from "./helper.js";\n';
const cleanSourceHelper = 'export const helper = "helper";\n';
const cleanTestSupport = 'export const support = "support";\n';

const runGate = async (
  overrides: Record<string, string> = {},
): Promise<{ output: string; status: number | null }> => {
  const fixtureDirectory = await mkdtemp(join(tmpdir(), "create-ts-lib-gate-"));

  try {
    const files: Record<string, string> = {
      ".fallowrc.jsonc": readGeneratedFallowConfig(),
      "package.json": fixturePackageJson,
      "source/index.ts": cleanSourceIndex,
      "source/helper.ts": cleanSourceHelper,
      "test/support.ts": cleanTestSupport,
      ...overrides,
    };

    for (const [relativePath, content] of Object.entries(files)) {
      const target = join(fixtureDirectory, relativePath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }

    const result = spawnSync(process.execPath, [fallowBin, "dead-code"], {
      cwd: fixtureDirectory,
      encoding: "utf8",
    });

    if (result.error) {
      throw result.error;
    }

    return { output: `${result.stdout}${result.stderr}`, status: result.status };
  } finally {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
};

describe("generated architecture gate", () => {
  it(
    "passes on a clean project",
    async () => {
      const { output, status } = await runGate();

      // The control case. Without it, the violation tests below could pass for
      // the wrong reason -- a fixture that always fails proves nothing.
      expect(status, output).toBe(0);
    },
    gateTestTimeout,
  );

  it(
    "fails when source imports from test",
    async () => {
      const { output, status } = await runGate({
        "source/index.ts": `${cleanSourceIndex}import { support } from "../test/support.js";\nexport const probe = support;\n`,
      });

      expect(status, output).toBe(1);
      expect(output).toContain("source/index.ts");
      expect(output.toLowerCase()).toContain("boundary");
    },
    gateTestTimeout,
  );

  it(
    "fails on a circular dependency",
    async () => {
      const { output, status } = await runGate({
        "source/helper.ts": `${cleanSourceHelper}import { helper as reexported } from "./index.js";\nexport const cycle = reexported;\n`,
      });

      expect(status, output).toBe(1);
      expect(output.toLowerCase()).toContain("circular");
    },
    gateTestTimeout,
  );

  it(
    "fails on an unresolved import",
    async () => {
      const { output, status } = await runGate({
        "source/index.ts": `${cleanSourceIndex}export { missing } from "./does-not-exist.js";\n`,
      });

      expect(status, output).toBe(1);
      expect(output.toLowerCase()).toContain("unresolved");
    },
    gateTestTimeout,
  );

  it(
    "fails on an undeclared dependency",
    async () => {
      const { output, status } = await runGate({
        "source/index.ts": `${cleanSourceIndex}${importFixtureDependency}`,
      });

      expect(status, output).toBe(1);
      expect(output).toContain(fixtureDependencyName);
      expect(output.toLowerCase()).toContain("unlisted");
    },
    gateTestTimeout,
  );

  it(
    "fails when source imports a devDependency",
    async () => {
      const { output, status } = await runGate({
        "package.json": fixturePackageJsonWithDevDependency,
        "source/index.ts": `${cleanSourceIndex}${importFixtureDependency}`,
      });

      expect(status, output).toBe(1);
      expect(output).toContain(fixtureDependencyName);
      expect(output.toLowerCase()).toContain("dev dependencies used in production");
    },
    gateTestTimeout,
  );

  it(
    "fails on a devDependency nothing imports",
    async () => {
      // `unused-dev-dependencies` is the sixth error-level rule in the
      // generated config; it catches tooling that was added to package.json but
      // never wired into a script, tsconfig, or vitest config.
      const { output, status } = await runGate({
        "package.json": fixturePackageJsonWithDevDependency,
      });

      expect(status, output).toBe(1);
      expect(output).toContain(fixtureDependencyName);
      expect(output.toLowerCase()).toContain("unused devdependencies");
    },
    gateTestTimeout,
  );
});
