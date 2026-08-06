import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Bounds for the read-only `git` calls whose output the generator parses. Each
 * one prints a single line, so a wedged invocation (an unresponsive network
 * filesystem, a stuck credential helper) or a pathological amount of output is
 * a failure to report, not something to wait on. Mutating commands such as
 * `git init` are deliberately left unbounded: killing those halfway could leave
 * a partially initialised repository behind.
 */
export const gitReadCommandOptions = {
  maxBuffer: 1024 * 1024,
  timeout: 5000,
} as const;

/**
 * Absolute path of the Git repository containing `cwd`, or undefined when
 * `cwd` does not exist or is not inside a repository.
 */
export const readGitRepositoryRoot = async (cwd: string): Promise<string | undefined> => {
  try {
    await access(cwd);
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      ...gitReadCommandOptions,
      cwd,
    });
    return stdout.trim();
  } catch {
    // A timeout or an oversized read lands here alongside "not a repository",
    // and all of them mean the same thing to every caller: no usable root.
    return undefined;
  }
};
