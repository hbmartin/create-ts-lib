import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ScaffoldConfig, ScaffoldProgress } from "../source/index.js";

const { execFileMock, spawnMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
  spawn: spawnMock,
}));

const baseConfig: ScaffoldConfig = {
  author: "Harold Martin <harold@example.com>",
  description: "A test library",
  githubRepoUrl: "",
  includeCli: false,
  includeCodecov: true,
  license: "MIT",
  packageManager: "pnpm",
  projectName: "example-lib",
};

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("scaffoldProject post-scaffold progress", () => {
  it("runs post-scaffold steps with progress messages", async () => {
    mockGitRepositoryCheckSuccess();
    mockSpawnClose(0);
    const progress = createProgress();
    const targetDirectory = await createTempTarget("create-ts-lib-progress-");
    const { scaffoldProject } = await import("../source/scaffold.js");

    await scaffoldProject(baseConfig, {
      progress,
      targetDirectory,
    });

    expect(progress.start).toHaveBeenCalledWith("Preparing git repository");
    expect(progress.start).toHaveBeenCalledWith("Installing dependencies");
    expect(progress.start).toHaveBeenCalledWith("Building generated project");
    expect(progress.start).toHaveBeenCalledWith("Testing generated project");
    expect(progress.succeed).toHaveBeenCalledWith("Git repository ready");
    expect(progress.succeed).toHaveBeenCalledWith("Dependencies installed");
    expect(progress.succeed).toHaveBeenCalledWith("Generated project built");
    expect(progress.succeed).toHaveBeenCalledWith("Generated project tested");
    expect(progress.fail).not.toHaveBeenCalled();
    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      "pnpm",
      ["install"],
      expect.objectContaining({ cwd: targetDirectory, stdio: "inherit" }),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      "pnpm",
      ["run", "build"],
      expect.objectContaining({ cwd: targetDirectory, stdio: "inherit" }),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      3,
      "pnpm",
      ["run", "test"],
      expect.objectContaining({ cwd: targetDirectory, stdio: "inherit" }),
    );
  });

  it("marks the active progress step as failed when a post-scaffold command rejects", async () => {
    mockGitRepositoryCheckSuccess();
    mockSpawnClose(1);
    const progress = createProgress();
    const targetDirectory = await createTempTarget("create-ts-lib-progress-fail-");
    const { PostScaffoldSetupError, scaffoldProject } = await import("../source/scaffold.js");

    let thrownError: unknown;
    try {
      await scaffoldProject(baseConfig, {
        progress,
        targetDirectory,
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(PostScaffoldSetupError);
    expect(thrownError).toMatchObject({
      packageManager: "pnpm",
      step: "install",
      targetDirectory,
    });
    expect(thrownError).toHaveProperty("message", "pnpm install exited with code 1");
    expect(progress.succeed).toHaveBeenCalledWith("Git repository ready");
    expect(progress.fail).toHaveBeenCalledWith("Installing dependencies");
  });

  it("reports unknown process close codes", async () => {
    mockSpawnClose(null);
    const targetDirectory = await createTempTarget("create-ts-lib-unknown-close-");
    const { runPackageManagerCommand } = await import("../source/scaffold.js");

    await expect(
      runPackageManagerCommand("pnpm", ["run", "build"], targetDirectory),
    ).rejects.toThrow("pnpm run build exited with code unknown");
  });
});

const createTempTarget = async (prefix: string): Promise<string> => {
  const tempDirectory = await mkdtemp(join(tmpdir(), prefix));

  return join(tempDirectory, "example-lib");
};

const createProgress = (): ScaffoldProgress => ({
  fail: vi.fn(),
  info: vi.fn(),
  start: vi.fn(),
  succeed: vi.fn(),
});

const mockGitRepositoryCheckSuccess = (): void => {
  execFileMock.mockImplementation((...args: unknown[]) => {
    const callback = args.findLast(
      (argument): argument is (error: Error | null, stdout: string, stderr: string) => void =>
        typeof argument === "function",
    );
    callback?.(null, "", "");

    return new EventEmitter();
  });
};

const mockSpawnClose = (code: number | null): void => {
  spawnMock.mockImplementation(() => {
    const childProcess = new EventEmitter();
    queueMicrotask(() => {
      childProcess.emit("close", code);
    });

    return childProcess;
  });
};
