import { spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { buildProjectFiles, type ScaffoldConfig } from "../source/templates/files.js";
import { semgrepVersion } from "../source/templates/generated-versions.js";
import { createTempDirectory } from "./helpers/temp-directory.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const securityLintScript = join(repositoryRoot, "scripts/security-lint.mjs");
const semgrepConfigPath = join(repositoryRoot, "semgrep.yml");
const semgrepArguments = ["scan", "--config", "semgrep.yml", "--error", "source", "test"];
// Metrics and the version check are disabled so the scan stays fast and
// hermetic in restricted-network environments.
const semgrepScanArguments = [
  "scan",
  "--config",
  "semgrep.yml",
  "--json",
  "--quiet",
  "--metrics=off",
  "--disable-version-check",
  "source",
  "test",
];
// Semgrep is a Python front end: interpreter start-up and rule loading dominate,
// and the cost swings enormously with what else the machine is doing. Measured
// for this one scan: ~4s through the `semgrep` binary on an idle machine, ~19s
// through `uvx` with an already-warm cache, and ~63s on a loaded machine under
// coverage. The old 20s budget sat inside that spread, so the verdict depended
// on the runner and the load rather than on the rules.
//
// `spawnSync` cannot be preempted, so vitest's timeout is a verdict rather than
// a budget: the scan runs to completion either way and a healthy run never
// spends the headroom. Sized above the worst honest run seen, not the typical
// one.
const semgrepScanTestTimeout = 120_000;
// `uvx semgrep@<pinned>` resolves, downloads, and installs on first use, which
// is tens of seconds cold. Paid in `beforeAll` so it is not charged to the scan
// test, and so a broken or offline uv reports itself as a warm-up failure
// instead of masquerading as a rules regression.
const semgrepWarmupTimeout = 180_000;

interface SemgrepScanOutput {
  results: Array<{
    path: string;
  }>;
}

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

const createFakeCommand = async (binDirectory: string, name: string): Promise<void> => {
  const executablePath = join(binDirectory, name);
  const script = String.raw`#!/bin/sh
{
  printf '%s\n' '${name}'
  for argument do
    printf '%s\n' "$argument"
  done
} > "$COMMAND_LOG"
exit 0
`;

  await writeFile(executablePath, script, "utf8");
  await chmod(executablePath, 0o755);
};

const hasRunnableCommand = (command: string): boolean => {
  const result = spawnSync(command, ["--version"], {
    stdio: "ignore",
  });

  return result.error === undefined && result.status === 0;
};

interface SemgrepRunner {
  command: string;
  leadingArguments: string[];
}

/**
 * Resolved once, at module load, because `it.skipIf` is a collection-time
 * decision that no hook can feed. Picking the runner up front also removes the
 * old ENOENT-probe-then-fall-back-to-uvx path, which charged a failed spawn and
 * a possible cold install to whichever test happened to run first.
 */
const resolveSemgrepRunner = (): SemgrepRunner | undefined => {
  if (hasRunnableCommand("semgrep")) {
    return { command: "semgrep", leadingArguments: [] };
  }

  if (hasRunnableCommand("uvx")) {
    return { command: "uvx", leadingArguments: [`semgrep@${semgrepVersion}`] };
  }

  return undefined;
};

const semgrepRunner = resolveSemgrepRunner();

const runSecurityLint = async (
  commands: string[],
  env: Record<string, string> = {},
): Promise<{
  commandLog: string[];
  stderr: string;
  status: number | null;
  stdout: string;
}> => {
  const tempDirectory = await createTempDirectory("create-ts-lib-security-lint-");
  const binDirectory = join(tempDirectory, "bin");
  const commandLogPath = join(tempDirectory, "command-log.txt");
  await mkdir(binDirectory);

  for (const command of commands) {
    await createFakeCommand(binDirectory, command);
  }

  const result = spawnSync(process.execPath, [securityLintScript], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      COMMAND_LOG: commandLogPath,
      PATH: binDirectory,
      SECURITY_LINT_FORCE_UVX: "",
      ...env,
    },
  });
  const commandLogContent = await readFile(commandLogPath, "utf8").catch(() => "");

  return {
    commandLog: commandLogContent.split(/\r?\n/u).filter((line) => line.length > 0),
    stderr: result.stderr,
    status: result.status,
    stdout: result.stdout,
  };
};

const runSemgrepScan = async (
  configContent: string,
  fixtures: Record<string, string>,
): Promise<SemgrepScanOutput> => {
  const tempDirectory = await createTempDirectory("create-ts-lib-semgrep-");
  const sourceDirectory = join(tempDirectory, "source");
  const testDirectory = join(tempDirectory, "test");
  await mkdir(sourceDirectory);
  await mkdir(testDirectory);
  await writeFile(join(tempDirectory, "semgrep.yml"), configContent, "utf8");

  for (const [fileName, content] of Object.entries(fixtures)) {
    await writeFile(join(sourceDirectory, fileName), content.trimStart(), "utf8");
  }

  if (semgrepRunner === undefined) {
    throw new Error("No Semgrep runner available; this test should have been skipped.");
  }

  const result = spawnSync(
    semgrepRunner.command,
    [...semgrepRunner.leadingArguments, ...semgrepScanArguments],
    { cwd: tempDirectory, encoding: "utf8" },
  );

  if (result.error) {
    throw result.error;
  }

  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as SemgrepScanOutput;
};

describe("security-lint wrapper", () => {
  it("uses semgrep from PATH by default", async () => {
    const result = await runSecurityLint(["semgrep", "uvx"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("");
    expect(result.commandLog).toEqual(["semgrep", ...semgrepArguments]);
  });

  it("uses pinned uvx Semgrep when SECURITY_LINT_FORCE_UVX is set", async () => {
    const result = await runSecurityLint(["semgrep", "uvx"], {
      SECURITY_LINT_FORCE_UVX: "1",
    });

    expect(result.status).toBe(0);
    expect(result.commandLog).toEqual(["uvx", `semgrep@${semgrepVersion}`, ...semgrepArguments]);
  });

  it("falls back to pinned uvx Semgrep when semgrep is missing", async () => {
    const result = await runSecurityLint(["uvx"]);

    expect(result.status).toBe(0);
    expect(result.commandLog).toEqual(["uvx", `semgrep@${semgrepVersion}`, ...semgrepArguments]);
  });

  it("warns when semgrep and uvx are both missing", async () => {
    const result = await runSecurityLint([]);

    expect(result.status).toBe(1);
    expect(result.commandLog).toEqual([]);
    expect(result.stderr).toContain(
      `warning: security:lint requires semgrep on PATH or uvx for semgrep@${semgrepVersion}.`,
    );
    expect(result.stderr).toContain(
      "warning: install Semgrep directly or install uv so uvx can run the pinned scan.",
    );
  });

  it("keeps generated wrapper content in sync with the root wrapper", async () => {
    const rootScript = await readFile(securityLintScript, "utf8");
    const generatedScript = buildProjectFiles(baseConfig).find(
      (file) => file.path === "scripts/security-lint.mjs",
    );

    expect(generatedScript?.content).toBe(rootScript);
  });
});

describe("Semgrep security rules", () => {
  // Guarded rather than skipped wholesale: the config-sync test below does not
  // need a runner, so this hook still fires when the scan test is skipped.
  beforeAll(() => {
    if (semgrepRunner === undefined) {
      return;
    }

    const warmup = spawnSync(
      semgrepRunner.command,
      [...semgrepRunner.leadingArguments, "--version"],
      { encoding: "utf8", stdio: "ignore" },
    );

    if (warmup.error) {
      throw warmup.error;
    }

    expect(warmup.status, "Semgrep warm-up failed").toBe(0);
  }, semgrepWarmupTimeout);

  it("keeps generated Semgrep config in sync with the root config", async () => {
    const rootConfig = await readFile(semgrepConfigPath, "utf8");
    const generatedConfig = buildProjectFiles(baseConfig).find(
      (file) => file.path === "semgrep.yml",
    );

    expect(generatedConfig?.content).toBe(rootConfig);
  });

  it.skipIf(semgrepRunner === undefined)(
    "flags child_process exec and execSync aliases",
    async () => {
      const scan = await runSemgrepScan(await readFile(semgrepConfigPath, "utf8"), {
        "default-import.ts": `
        import childProcess from "child_process";

        childProcess.exec("echo unsafe");
        childProcess.execSync("echo unsafe");
      `,
        "named-import.ts": `
        import { exec, execSync } from "node:child_process";

        exec("echo unsafe");
        execSync("echo unsafe");
      `,
        "named-import-alias.ts": `
        import { exec as run, execSync as runSync } from "child_process";

        run("echo unsafe");
        runSync("echo unsafe");
      `,
        "namespace-import.ts": `
        import * as childProcess from "node:child_process";

        childProcess.exec("echo unsafe");
        childProcess.execSync("echo unsafe");
      `,
        "require-destructure.ts": `
        const { exec, execSync } = require("child_process");

        exec("echo unsafe");
        execSync("echo unsafe");
      `,
        "require-destructure-alias.ts": `
        const { exec: run, execSync: runSync } = require("node:child_process");

        run("echo unsafe");
        runSync("echo unsafe");
      `,
        "require-namespace.ts": `
        const childProcess = require("node:child_process");

        childProcess.exec("echo unsafe");
        childProcess.execSync("echo unsafe");
      `,
      });

      const findingCounts = scan.results.reduce<Record<string, number>>((counts, result) => {
        const fileName = result.path.split(/[\\/]/u).at(-1) ?? result.path;
        counts[fileName] = (counts[fileName] ?? 0) + 1;
        return counts;
      }, {});

      expect(findingCounts).toEqual({
        "default-import.ts": 2,
        "named-import.ts": 2,
        "named-import-alias.ts": 2,
        "namespace-import.ts": 2,
        "require-destructure.ts": 2,
        "require-destructure-alias.ts": 2,
        "require-namespace.ts": 2,
      });
    },
    semgrepScanTestTimeout,
  );
});
