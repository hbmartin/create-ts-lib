import { readdir } from "node:fs/promises";

import { isErrorWithCode } from "./filesystem-errors.js";

export const assertTargetDirectoryIsSafe = async (
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
    // Only a missing directory is safe; anything else (including a regular
    // file occupying the target path) must surface.
    if (isErrorWithCode(error, "ENOENT")) {
      return;
    }

    throw error;
  }
};
