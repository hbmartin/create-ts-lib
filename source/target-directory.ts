import { readdir } from "node:fs/promises";

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
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }

    throw error;
  }
};

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;
