import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import { buildProjectFiles, type PackageManager, type ScaffoldConfig } from "./templates/files.js";

const execFileAsync = promisify(execFile);

export interface ScaffoldOptions {
  postScaffold?: boolean;
  targetDirectory: string;
}

export const scaffoldProject = async (
  config: ScaffoldConfig,
  options: ScaffoldOptions,
): Promise<void> => {
  const targetDirectory = resolve(options.targetDirectory);
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
    await initializeGitRepositoryIfNeeded(targetDirectory);
    await runPackageManagerCommand(config.packageManager, ["install"], targetDirectory);
    await runPackageManagerCommand(config.packageManager, ["run", "build"], targetDirectory);
    await runPackageManagerCommand(config.packageManager, ["run", "test"], targetDirectory);
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

      rejectPromise(new Error(`${packageManager} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  });
};
