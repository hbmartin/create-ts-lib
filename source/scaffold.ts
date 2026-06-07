import { execFile, spawn } from "node:child_process";
import { access, chmod, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { assertValidPackageName } from "./package-name.js";
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
  postScaffold?: boolean;
  progress?: ScaffoldProgress;
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
    super(getErrorMessage(options.cause, "Post-scaffold setup failed"), {
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
      },
    );
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

const assertTargetDirectoryIsSafe = async (
  targetDirectory: string,
  force: boolean,
): Promise<void> => {
  try {
    const existingEntries = await readdir(targetDirectory);
    if (!force && existingEntries.length > 0) {
      throw new Error(
        `Target directory is not empty: ${targetDirectory}. Re-run with --force to overwrite generated files.`,
      );
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }

    throw error;
  }
};

export const initializeGitRepositoryIfNeeded = async (cwd: string): Promise<void> => {
  const insideRepository = await isInsideGitRepository(cwd);

  if (!insideRepository) {
    await execFileAsync("git", ["init"], { cwd });
  }
};

const isInsideGitRepository = async (cwd: string): Promise<boolean> => {
  try {
    await access(cwd);
    await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
    return true;
  } catch {
    return false;
  }
};

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

export const runPackageManagerCommand = async (
  packageManager: PackageManager,
  args: string[],
  cwd: string,
): Promise<void> => {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const childProcess = spawn(packageManager, args, {
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

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;
