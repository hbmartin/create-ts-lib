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
    await runProgressStep(
      options.progress,
      "Preparing git repository",
      "Git repository ready",
      async () => {
        await initializeGitRepositoryIfNeeded(targetDirectory);
      },
    );
    await runProgressStep(
      options.progress,
      "Installing dependencies",
      "Dependencies installed",
      async () => {
        await runPackageManagerCommand(config.packageManager, ["install"], targetDirectory);
      },
    );
    await runProgressStep(
      options.progress,
      "Building generated project",
      "Generated project built",
      async () => {
        await runPackageManagerCommand(config.packageManager, ["run", "build"], targetDirectory);
      },
    );
    await runProgressStep(
      options.progress,
      "Testing generated project",
      "Generated project tested",
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

const runProgressStep = async (
  progress: ScaffoldProgress | undefined,
  startMessage: string,
  successMessage: string,
  action: () => Promise<void>,
): Promise<void> => {
  progress?.start(startMessage);
  try {
    await action();
    progress?.succeed(successMessage);
  } catch (error) {
    progress?.fail(startMessage);
    throw error;
  }
};
