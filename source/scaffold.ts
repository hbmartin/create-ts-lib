import { execFile, spawn } from "node:child_process";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { formatErrorMessage } from "./filesystem-errors.js";
import { assertValidPackageName } from "./package-name.js";
import { equalResolvedPaths } from "./path-comparison.js";
import { assertTargetDirectoryIsSafe } from "./target-directory.js";
import { buildProjectFiles, type PackageManager, type ScaffoldConfig } from "./templates/files.js";

const execFileAsync = promisify(execFile);

export interface ScaffoldProgress {
  fail(message: string): void;
  info(message: string): void;
  start(message: string): void;
  succeed(message: string): void;
}

export interface ScaffoldOptions {
  force?: boolean;
  gitRemoteOriginUrl?: string;
  postScaffold?: boolean;
  progress?: ScaffoldProgress;
  skipGit?: boolean;
  skipInstall?: boolean;
  targetDirectory: string;
}

export type PostScaffoldSetupStep = "git" | "install" | "build" | "test";

interface PostScaffoldSetupErrorOptions {
  cause: unknown;
  packageManager: PackageManager;
  step: PostScaffoldSetupStep;
  targetDirectory: string;
}

export class PostScaffoldSetupError extends Error {
  readonly packageManager: PackageManager;
  readonly step: PostScaffoldSetupStep;
  readonly targetDirectory: string;

  constructor(options: PostScaffoldSetupErrorOptions) {
    super(formatErrorMessage(options.cause, "Post-scaffold setup failed"), {
      cause: options.cause,
    });
    this.name = "PostScaffoldSetupError";
    this.packageManager = options.packageManager;
    this.step = options.step;
    this.targetDirectory = options.targetDirectory;
  }
}

/**
 * Write a generated TypeScript library to disk and optionally run post-scaffold setup.
 */
export const scaffoldProject = async (
  config: ScaffoldConfig,
  options: ScaffoldOptions,
): Promise<void> => {
  assertValidPackageName(config.projectName);

  const targetDirectory = resolve(options.targetDirectory);
  await assertTargetDirectoryIsSafe(targetDirectory, options.force === true);
  await mkdir(targetDirectory, { recursive: true });

  for (const file of buildProjectFiles(config)) {
    const fullPath = resolve(targetDirectory, file.path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, file.content, "utf8");

    if (file.executable) {
      await chmod(fullPath, 0o755);
    }
  }

  if (options.postScaffold !== false) {
    if (options.skipGit === true) {
      options.progress?.info("Skipping git setup (--skip-git).");
    } else {
      await runPostScaffoldStep(
        {
          packageManager: config.packageManager,
          progress: options.progress,
          startMessage: "Preparing git repository",
          step: "git",
          successMessage: "Git repository ready",
          targetDirectory,
        },
        async () => {
          await initializeGitRepositoryIfNeeded(targetDirectory);
          if (options.gitRemoteOriginUrl && options.gitRemoteOriginUrl.length > 0) {
            await addGitRemoteOriginIfPossible(
              targetDirectory,
              options.gitRemoteOriginUrl,
              options.progress,
            );
          }
        },
      );
    }

    if (options.skipInstall === true) {
      options.progress?.info("Skipping dependency install, build, and test (--skip-install).");
      return;
    }

    await runPostScaffoldStep(
      {
        packageManager: config.packageManager,
        progress: options.progress,
        startMessage: "Installing dependencies",
        step: "install",
        successMessage: "Dependencies installed",
        targetDirectory,
      },
      async () => {
        await runPackageManagerCommand(config.packageManager, ["install"], targetDirectory);
      },
    );
    await runPostScaffoldStep(
      {
        packageManager: config.packageManager,
        progress: options.progress,
        startMessage: "Building generated project",
        step: "build",
        successMessage: "Generated project built",
        targetDirectory,
      },
      async () => {
        await runPackageManagerCommand(config.packageManager, ["run", "build"], targetDirectory);
      },
    );
    await runPostScaffoldStep(
      {
        packageManager: config.packageManager,
        progress: options.progress,
        startMessage: "Testing generated project",
        step: "test",
        successMessage: "Generated project tested",
        targetDirectory,
      },
      async () => {
        await runPackageManagerCommand(config.packageManager, ["run", "test"], targetDirectory);
      },
    );
  }
};

export const initializeGitRepositoryIfNeeded = async (cwd: string): Promise<void> => {
  const repositoryRoot = await readGitRepositoryRoot(cwd);

  if (repositoryRoot === undefined) {
    await execFileAsync("git", ["init"], { cwd });
  }
};

const readGitRepositoryRoot = async (cwd: string): Promise<string | undefined> => {
  try {
    await access(cwd);
    const result = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
    return getExecFileStdout(result).trim();
  } catch {
    return undefined;
  }
};

const addGitRemoteOriginIfPossible = async (
  cwd: string,
  remoteUrl: string,
  progress: ScaffoldProgress | undefined,
): Promise<void> => {
  const repositoryRoot = await readGitRepositoryRoot(cwd);

  if (repositoryRoot === undefined) {
    progress?.info("Could not add git remote origin because the target is not a Git repository.");
    return;
  }

  if (!equalResolvedPaths(repositoryRoot, cwd)) {
    progress?.info(
      `Skipping git remote origin because the target is inside an existing Git repository: ${repositoryRoot}`,
    );
    return;
  }

  try {
    await execFileAsync("git", ["remote", "add", "origin", remoteUrl], { cwd });
  } catch (error) {
    progress?.info(
      `Could not add git remote origin; continuing. ${formatErrorMessage(error, "git remote add failed")}`,
    );
  }
};

export const runPackageManagerCommand = async (
  packageManager: PackageManager,
  args: string[],
  cwd: string,
): Promise<void> => {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const childProcess = spawn(getPackageManagerExecutable(packageManager), args, {
      cwd,
      stdio: "inherit",
    });

    childProcess.on("error", rejectPromise);
    childProcess.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(
        new Error(`${packageManager} ${args.join(" ")} exited with code ${code ?? "unknown"}`),
      );
    });
  });
};

export const getPackageManagerExecutable = (
  packageManager: PackageManager,
  platform: NodeJS.Platform = process.platform,
): string => (platform === "win32" ? `${packageManager}.cmd` : packageManager);

interface PostScaffoldStepOptions {
  packageManager: PackageManager;
  progress: ScaffoldProgress | undefined;
  startMessage: string;
  step: PostScaffoldSetupStep;
  successMessage: string;
  targetDirectory: string;
}

const runPostScaffoldStep = async (
  options: PostScaffoldStepOptions,
  action: () => Promise<void>,
): Promise<void> => {
  options.progress?.start(options.startMessage);
  try {
    await action();
    options.progress?.succeed(options.successMessage);
  } catch (error) {
    options.progress?.fail(options.startMessage);
    throw new PostScaffoldSetupError({
      cause: error,
      packageManager: options.packageManager,
      step: options.step,
      targetDirectory: options.targetDirectory,
    });
  }
};

const getExecFileStdout = (result: { stdout: string }): string => result.stdout;
