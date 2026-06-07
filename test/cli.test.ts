import { basename } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import packageJson from "../package.json" with { type: "json" };
import type { DetectedDefaults } from "../source/cli-helpers.js";

const originalArgv = process.argv;
const originalExitCode = process.exitCode;

interface CliResult {
  exitCode: NodeJS.Process["exitCode"];
  stderr: string;
  stdout: string;
}

interface RunCliOptions {
  detectedDefaults?: Partial<DetectedDefaults>;
  promptModule?: {
    confirm(options: { message: string }): Promise<boolean>;
    input(options: {
      default?: string;
      message: string;
      validate?: (value: string) => boolean | string;
    }): Promise<string>;
    select(options: { message: string }): Promise<string>;
  };
  scaffoldProject?: ReturnType<typeof vi.fn>;
}

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("cli entrypoint", () => {
  it("prints the package version", async () => {
    const result = await runCli(["--version"]);

    expect(result).toMatchObject({
      exitCode: undefined,
      stderr: "",
      stdout: `${packageJson.version}\n`,
    });
  });

  it("prints help with the pnpm create example", async () => {
    const result = await runCli(["--help"]);

    expect(result.exitCode).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("pnpm create @hbmartin/ts-lib my-lib");
  });

  it("prints an error and help for invalid arguments", async () => {
    const result = await runCli(["--bad"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown option: --bad");
    expect(result.stderr).toContain("Usage:");
  });

  it("prints a dry-run scaffold plan without writing files", async () => {
    const result = await runCli(["demo-lib", "--yes", "--dry-run"]);

    expect(result.exitCode).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Dry run");
    expect(result.stdout).toContain("Project: demo-lib");
    expect(result.stdout).toContain("License: Apache-2.0");
    expect(result.stdout).toContain("Files to create:");
    expect(result.stdout).toContain("package.json");
  });

  it("rejects invalid project names in --yes mode", async () => {
    const result = await runCli(["My Lib", "--yes", "--dry-run"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain('Invalid project name "My Lib"');
    expect(result.stderr).toContain("lowercase");
    expect(result.stderr).toContain("whitespace");
  });

  it("uses prompted values when --yes is omitted", async () => {
    const promptModule = {
      confirm: vi.fn(
        async ({ message }: { message: string }) => message === "Include CLI entry point?",
      ),
      input: vi.fn(
        async ({
          default: defaultValue,
          message,
          validate,
        }: {
          default?: string;
          message: string;
          validate?: (value: string) => boolean | string;
        }) => {
          if (message === "Project name") {
            expect(validate?.("My Lib")).toContain("lowercase");
            expect(validate?.("prompt-lib")).toBe(true);
            return defaultValue ?? "prompt-lib";
          }

          if (message === "Description") {
            return "Prompted description";
          }

          if (message === "Author") {
            return "Prompt Author <prompt@example.com>";
          }

          return "https://github.com/hbmartin/prompt-lib";
        },
      ),
      select: vi.fn(async ({ message }: { message: string }) =>
        message === "License" ? "Apache-2.0" : "pnpm",
      ),
    };

    const result = await runCli(["prompt-lib", "--dry-run"], { promptModule });

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain("Description: Prompted description");
    expect(result.stdout).toContain("Author: Prompt Author <prompt@example.com>");
    expect(result.stdout).toContain("License: Apache-2.0");
    expect(result.stdout).toContain("Package manager: pnpm");
    expect(result.stdout).toContain("CLI entry: yes");
    expect(promptModule.input).toHaveBeenCalledTimes(4);
    expect(promptModule.confirm).toHaveBeenCalledTimes(2);
    expect(promptModule.select).toHaveBeenCalledTimes(2);
  });

  it("scaffolds the project and prints next steps", async () => {
    const scaffoldProject = vi.fn(async () => undefined);

    const result = await runCli(["demo-lib", "--yes"], { scaffoldProject });

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain("Created demo-lib");
    expect(result.stdout).toContain("cd demo-lib");
    expect(result.stdout).toContain("pnpm run lint");
    expect(scaffoldProject).toHaveBeenCalledWith(
      expect.objectContaining({ packageManager: "pnpm", projectName: "demo-lib" }),
      expect.objectContaining({ targetDirectory: expect.stringContaining("demo-lib") }),
    );
  });

  it("passes --force to the scaffold operation", async () => {
    const scaffoldProject = vi.fn(async () => undefined);

    await runCli(["demo-lib", "--yes", "--force"], { scaffoldProject });

    expect(scaffoldProject).toHaveBeenCalledWith(
      expect.objectContaining({ projectName: "demo-lib" }),
      expect.objectContaining({ force: true }),
    );
  });
});

const runCli = async (args: string[], options: RunCliOptions = {}): Promise<CliResult> => {
  vi.resetModules();
  vi.doUnmock("../source/cli-helpers.js");
  vi.doUnmock("../source/prompts.js");
  vi.doUnmock("../source/scaffold.js");

  vi.doMock("../source/cli-helpers.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../source/cli-helpers.js")>();

    return {
      ...actual,
      detectDefaults: vi.fn(async (directoryArgument: string | undefined) => ({
        ...buildDetectedDefaults(directoryArgument),
        ...options.detectedDefaults,
      })),
    };
  });

  if (options.promptModule) {
    vi.doMock("../source/prompts.js", () => ({
      loadPromptModule: async () => options.promptModule,
    }));
  }

  if (options.scaffoldProject) {
    vi.doMock("../source/scaffold.js", () => ({
      scaffoldProject: options.scaffoldProject,
    }));
  }

  const stdout: string[] = [];
  const stderr: string[] = [];
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => {
    stdout.push(chunk);
    return true;
  }) as typeof process.stdout.write);
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => {
    stderr.push(chunk);
    return true;
  }) as typeof process.stderr.write);

  process.argv = [process.execPath, "create-ts-lib", ...args];
  process.exitCode = undefined;

  try {
    await import("../source/cli.js");
    return {
      exitCode: process.exitCode,
      stderr: stderr.join(""),
      stdout: stdout.join(""),
    };
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
};

const buildDetectedDefaults = (directoryArgument: string | undefined): DetectedDefaults => ({
  author: "Test Author <test@example.com>",
  githubRepoUrl: "https://github.com/hbmartin/create-ts-lib",
  projectName: directoryArgument ? basename(directoryArgument) : "my-lib",
});
