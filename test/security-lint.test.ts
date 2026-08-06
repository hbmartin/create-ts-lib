import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildProjectFiles, type ScaffoldConfig } from "../source/templates/files.js";
import { semgrepVersion } from "../source/templates/generated-versions.js";

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
const semgrepScanTestTimeout = 20_000;

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

const isMissingCommandError = (error: Error | undefined): boolean =>
  (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";

const hasRunnableCommand = (command: string): boolean => {
  const result = spawnSync(command, ["--version"], {
    stdio: "ignore",
  });

  return result.error === undefined && result.status === 0;
};

const hasSemgrepRunner = hasRunnableCommand("semgrep") || hasRunnableCommand("uvx");

const runSecurityLint = async (
  commands: string[],
  env: Record<string, string> = {},
): Promise<{
  commandLog: string[];
  stderr: string;
  status: number | null;
  stdout: string;
}> => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "create-ts-lib-security-lint-"));
  try {
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
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
};

const runSemgrepScan = async (
  configContent: string,
  fixtures: Record<string, string>,
): Promise<SemgrepScanOutput> => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "create-ts-lib-semgrep-"));
  try {
    const sourceDirectory = join(tempDirectory, "source");
    const testDirectory = join(tempDirectory, "test");
    await mkdir(sourceDirectory);
    await mkdir(testDirectory);
    await writeFile(join(tempDirectory, "semgrep.yml"), configContent, "utf8");

    for (const [fileName, content] of Object.entries(fixtures)) {
      await writeFile(join(sourceDirectory, fileName), content.trimStart(), "utf8");
    }

    let result = spawnSync("semgrep", semgrepScanArguments, {
      cwd: tempDirectory,
      encoding: "utf8",
    });

    if (isMissingCommandError(result.error)) {
      result = spawnSync("uvx", [`semgrep@${semgrepVersion}`, ...semgrepScanArguments], {
        cwd: tempDirectory,
        encoding: "utf8",
      });
    }

    if (result.error) {
      throw result.error;
    }

    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout) as SemgrepScanOutput;
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
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
  it("keeps generated Semgrep config in sync with the root config", async () => {
    const rootConfig = await readFile(semgrepConfigPath, "utf8");
    const generatedConfig = buildProjectFiles(baseConfig).find(
      (file) => file.path === "semgrep.yml",
    );

    expect(generatedConfig?.content).toBe(rootConfig);
  });

  it.skipIf(!hasSemgrepRunner)(
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
