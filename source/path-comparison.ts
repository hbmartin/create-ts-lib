import { isAbsolute, relative, resolve } from "node:path";

interface PathComparisonOptions {
  caseInsensitive?: boolean;
}

/**
 * Whether `candidate` resolves to something strictly inside `parent`.
 *
 * `resolve` restarts at an absolute segment, so `resolve(target, "/etc/hosts")`
 * is `/etc/hosts` -- joining an untrusted path onto a trusted root proves
 * nothing about where it lands. Callers that turn user-supplied strings into
 * filesystem operands have to check the result, not the input.
 */
export const isInsideDirectory = (parent: string, candidate: string): boolean => {
  const relativePath = relative(resolve(parent), resolve(candidate));

  return relativePath.length > 0 && !relativePath.startsWith("..") && !isAbsolute(relativePath);
};

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
