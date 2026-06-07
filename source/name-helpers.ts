const gitSuffixRegex = /\.git$/u;
const packageScopeRegex = /^@[^/]+\//u;
const githubRemotePrefixes = [
  ["git@github.com:", "https://github.com/"],
  ["git+ssh://git@github.com/", "https://github.com/"],
  ["ssh://git@github.com/", "https://github.com/"],
  ["git://github.com/", "https://github.com/"],
  ["git+https://github.com/", "https://github.com/"],
  ["https://github.com/", "https://github.com/"],
] as const;

export const stripGitSuffix = (input: string): string => input.replace(gitSuffixRegex, "");

export const normalizeGitHubUrl = (input: string): string => {
  if (input.length === 0) {
    return "";
  }

  for (const [prefix, normalizedPrefix] of githubRemotePrefixes) {
    if (input.startsWith(prefix)) {
      return `${normalizedPrefix}${stripGitSuffix(input.slice(prefix.length))}`;
    }
  }

  return input;
};

export const stripPackageScope = (packageName: string): string =>
  packageName.replace(packageScopeRegex, "");
