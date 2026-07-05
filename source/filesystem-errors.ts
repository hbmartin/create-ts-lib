export const isErrorWithCode = (error: unknown, code: number | string): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === code;

// ENOTDIR (a path component is a regular file) guarantees the file cannot
// exist, so it is treated the same as ENOENT.
export const isFileNotFoundError = (error: unknown): boolean =>
  isErrorWithCode(error, "ENOENT") || isErrorWithCode(error, "ENOTDIR");

export const formatErrorMessage = (error: unknown, fallback?: string): string =>
  error instanceof Error ? error.message : (fallback ?? String(error));
