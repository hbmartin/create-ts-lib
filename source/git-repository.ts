import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Absolute path of the Git repository containing `cwd`, or undefined when
 * `cwd` does not exist or is not inside a repository.
 */
export const readGitRepositoryRoot = async (cwd: string): Promise<string | undefined> => {
  try {
    await access(cwd);
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
    return stdout.trim();
  } catch {
    return undefined;
  }
};
