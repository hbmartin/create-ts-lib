export const isFileNotFoundError = (error: unknown): boolean =>
  error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";

export const formatErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
