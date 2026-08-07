import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { onTestFinished } from "vitest";

/**
 * `mkdtemp` scoped to the test that calls it: the root is removed when that test
 * finishes, pass or fail.
 *
 * Cleanup registers through `onTestFinished` rather than a module-level
 * `afterEach` because the hook attaches to whichever test is *running*, not to
 * whichever file happened to import this module first. That makes one helper
 * serve every test file with no per-file registration, and it keeps working if
 * vitest's `isolate` is ever turned off.
 *
 * Must be called from inside a test body -- `onTestFinished` throws in a suite
 * body or a `beforeAll` hook. Cleanup runs under `hookTimeout` (5s by default),
 * which is ample for a scaffolded fixture but would not be for a directory
 * holding an installed `node_modules`.
 */
export const createTempDirectory = async (prefix: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), prefix));

  onTestFinished(async () => {
    await rm(directory, { force: true, maxRetries: 3, recursive: true });
  });

  return directory;
};

/**
 * A path inside a fresh temp root. The path itself is *not* created: callers
 * hand it to the code under test, which creates it.
 *
 * The root is still tracked and removed, which is the whole point. Every leak
 * this helper replaced came from a fixture that returned `join(root, "name")`
 * and dropped `root`, leaving the caller nothing to clean up.
 */
export const createTempPath = async (prefix: string, ...segments: string[]): Promise<string> =>
  join(await createTempDirectory(prefix), ...segments);
