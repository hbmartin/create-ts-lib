import { resolve } from "node:path";

interface PathComparisonOptions {
  caseInsensitive?: boolean;
}

export const equalResolvedPaths = (
  left: string,
  right: string,
  options: PathComparisonOptions = {},
): boolean => {
  const caseInsensitive = options.caseInsensitive ?? isCaseInsensitivePathPlatform();

  return (
    normalizeResolvedPath(left, caseInsensitive) === normalizeResolvedPath(right, caseInsensitive)
  );
};

const normalizeResolvedPath = (path: string, caseInsensitive: boolean): string => {
  const resolvedPath = resolve(path);

  return caseInsensitive ? resolvedPath.toLowerCase() : resolvedPath;
};

const isCaseInsensitivePathPlatform = (): boolean =>
  process.platform === "darwin" || process.platform === "win32";
