import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildProjectFiles, type ScaffoldConfig } from "../source/templates/files.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const securityLintScript = join(repositoryRoot, "scripts/security-lint.mjs");
const semgrepArguments = ["scan", "--config", "semgrep.yml", "--error", "source", "test"];

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

const createFakeCommand = async (binDirectory: string, name: string): Promise<void> => {
  const executablePath = join(binDirectory, name);
  const script = `#!/bin/sh
{
  printf '%s\\n' '${name}'
  for argument do
    printf '%s\\n' "$argument"
  done
} > "$COMMAND_LOG"
exit 0
`;

  await writeFile(executablePath, script, "utf8");
  await chmod(executablePath, 0o755);
};

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
    expect(result.commandLog).toEqual(["uvx", "semgrep@1.165.0", ...semgrepArguments]);
  });

  it("falls back to pinned uvx Semgrep when semgrep is missing", async () => {
    const result = await runSecurityLint(["uvx"]);

    expect(result.status).toBe(0);
    expect(result.commandLog).toEqual(["uvx", "semgrep@1.165.0", ...semgrepArguments]);
  });

  it("warns when semgrep and uvx are both missing", async () => {
    const result = await runSecurityLint([]);

    expect(result.status).toBe(1);
    expect(result.commandLog).toEqual([]);
    expect(result.stderr).toContain(
      "warning: security:lint requires semgrep on PATH or uvx for semgrep@1.165.0.",
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
