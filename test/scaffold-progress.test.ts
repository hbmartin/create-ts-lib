import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ScaffoldConfig, ScaffoldProgress } from "../source/index.js";

const { execFileMock, spawnMock } = vi.hoisted(() => {
  const hoistedExecFileMock = vi.fn();
  Object.defineProperty(hoistedExecFileMock, Symbol.for("nodejs.util.promisify.custom"), {
    value: (...args: unknown[]): Promise<{ stderr: string; stdout: string }> =>
      new Promise((resolve, reject) => {
        hoistedExecFileMock(...args, (error: Error | null, stdout: string, stderr: string) => {
          if (error) {
            reject(error);
            return;
          }

          resolve({ stderr, stdout });
        });
      }),
  });

  return {
    execFileMock: hoistedExecFileMock,
    spawnMock: vi.fn(),
  };
});

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
  spawn: spawnMock,
}));

const baseConfig: ScaffoldConfig = {
  author: "Harold Martin <harold@example.com>",
  bundler: "tsc",
  copyrightYear: "2026",
  description: "A test library",
  githubRepoUrl: "",
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
    expect(spawnMock.mock.calls[0]?.[2]).not.toHaveProperty("shell");
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

  it("adds git remote origin when requested for the generated repository", async () => {
    const targetDirectory = await createTempTarget("create-ts-lib-remote-");
    mockExecFileSequence([
      { error: new Error("not a git repository") },
      {},
      { stdout: targetDirectory },
      {},
    ]);
    mockSpawnClose(0);
    const progress = createProgress();
    const { scaffoldProject } = await import("../source/scaffold.js");

    await scaffoldProject(baseConfig, {
      gitRemoteOriginUrl: "https://github.com/hbmartin/example-lib",
      progress,
      targetDirectory,
    });

    expect(execFileMock).toHaveBeenCalledWith(
      "git",
      ["init"],
      expect.objectContaining({ cwd: targetDirectory }),
      expect.any(Function),
    );
    expect(execFileMock).toHaveBeenCalledWith(
      "git",
      ["remote", "add", "origin", "https://github.com/hbmartin/example-lib"],
      expect.objectContaining({ cwd: targetDirectory }),
      expect.any(Function),
    );
    expect(progress.info).not.toHaveBeenCalled();
  });

  it("skips git remote origin when the target is inside a parent repository", async () => {
    const targetDirectory = await createTempTarget("create-ts-lib-parent-");
    mockExecFileSequence([{ stdout: "/parent/repo" }, { stdout: "/parent/repo" }]);
    mockSpawnClose(0);
    const progress = createProgress();
    const { scaffoldProject } = await import("../source/scaffold.js");

    await scaffoldProject(baseConfig, {
      gitRemoteOriginUrl: "https://github.com/hbmartin/example-lib",
      progress,
      targetDirectory,
    });

    expect(execFileMock).not.toHaveBeenCalledWith(
      "git",
      ["remote", "add", "origin", "https://github.com/hbmartin/example-lib"],
      expect.any(Object),
      expect.any(Function),
    );
    expect(progress.info).toHaveBeenCalledWith(
      "Skipping git remote origin because the target is inside an existing Git repository: /parent/repo",
    );
  });

  it("warns and continues when the target git repository cannot be resolved after init", async () => {
    const targetDirectory = await createTempTarget("create-ts-lib-unresolved-git-");
    mockExecFileSequence([
      { error: new Error("not a git repository") },
      {},
      { error: new Error("still not a git repository") },
    ]);
    mockSpawnClose(0);
    const progress = createProgress();
    const { scaffoldProject } = await import("../source/scaffold.js");

    await scaffoldProject(baseConfig, {
      gitRemoteOriginUrl: "https://github.com/hbmartin/example-lib",
      progress,
      targetDirectory,
    });

    expect(progress.info).toHaveBeenCalledWith(
      "Could not add git remote origin because the target is not a Git repository.",
    );
    expect(progress.succeed).toHaveBeenCalledWith("Generated project tested");
  });

  it("warns and continues when git remote origin cannot be added", async () => {
    const targetDirectory = await createTempTarget("create-ts-lib-remote-fail-");
    mockExecFileSequence([
      { stdout: targetDirectory },
      { stdout: targetDirectory },
      { error: new Error("remote origin already exists") },
    ]);
    mockSpawnClose(0);
    const progress = createProgress();
    const { scaffoldProject } = await import("../source/scaffold.js");

    await scaffoldProject(baseConfig, {
      gitRemoteOriginUrl: "https://github.com/hbmartin/example-lib",
      progress,
      targetDirectory,
    });

    expect(progress.info).toHaveBeenCalledWith(
      "Could not add git remote origin; continuing. remote origin already exists",
    );
    expect(progress.succeed).toHaveBeenCalledWith("Generated project tested");
  });

  it("skips git setup while still installing when skipGit is set", async () => {
    mockSpawnClose(0);
    const progress = createProgress();
    const targetDirectory = await createTempTarget("create-ts-lib-skip-git-");
    const { scaffoldProject } = await import("../source/scaffold.js");

    await scaffoldProject(baseConfig, {
      gitRemoteOriginUrl: "https://github.com/hbmartin/example-lib",
      progress,
      skipGit: true,
      targetDirectory,
    });

    expect(execFileMock).not.toHaveBeenCalled();
    expect(progress.info).toHaveBeenCalledWith("Skipping git setup (--skip-git).");
    expect(progress.succeed).toHaveBeenCalledWith("Dependencies installed");
    expect(progress.succeed).toHaveBeenCalledWith("Generated project built");
    expect(progress.succeed).toHaveBeenCalledWith("Generated project tested");
  });

  it("skips git setup in workspace mode without needing --skip-git", async () => {
    mockSpawnClose(0);
    const progress = createProgress();
    const targetDirectory = await createTempTarget("create-ts-lib-workspace-");
    const { scaffoldProject } = await import("../source/scaffold.js");

    await scaffoldProject(
      { ...baseConfig, workspaceMode: true },
      {
        gitRemoteOriginUrl: "https://github.com/hbmartin/example-lib",
        progress,
        targetDirectory,
      },
    );

    // No git init and no remote wiring: the workspace repository owns both.
    expect(execFileMock).not.toHaveBeenCalled();
    expect(progress.info).toHaveBeenCalledWith(
      "Skipping git setup; the workspace repository owns it.",
    );
    expect(progress.succeed).toHaveBeenCalledWith("Dependencies installed");
  });

  it("skips install, build, and test while still preparing git when skipInstall is set", async () => {
    mockGitRepositoryCheckSuccess();
    mockSpawnClose(0);
    const progress = createProgress();
    const targetDirectory = await createTempTarget("create-ts-lib-skip-install-");
    const { scaffoldProject } = await import("../source/scaffold.js");

    await scaffoldProject(baseConfig, {
      progress,
      skipInstall: true,
      targetDirectory,
    });

    expect(progress.succeed).toHaveBeenCalledWith("Git repository ready");
    expect(progress.info).toHaveBeenCalledWith(
      "Skipping dependency install, build, and test (--skip-install).",
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("skips git remote origin when post-scaffold setup is disabled", async () => {
    const targetDirectory = await createTempTarget("create-ts-lib-no-post-");
    const { scaffoldProject } = await import("../source/scaffold.js");

    await scaffoldProject(baseConfig, {
      gitRemoteOriginUrl: "https://github.com/hbmartin/example-lib",
      postScaffold: false,
      targetDirectory,
    });

    expect(execFileMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
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

const mockExecFileSequence = (responses: Array<{ error?: Error; stdout?: string }>): void => {
  execFileMock.mockImplementation((...args: unknown[]) => {
    const callback = args.findLast(
      (argument): argument is (error: Error | null, stdout: string, stderr: string) => void =>
        typeof argument === "function",
    );
    const response = responses.shift() ?? {};

    callback?.(response.error ?? null, response.stdout ?? "", "");

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
