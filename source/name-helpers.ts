const gitSuffixRegex = /\.git$/u;
const packageScopeRegex = /^@[^/]+\//u;

export const stripGitSuffix = (input: string): string => input.replace(gitSuffixRegex, "");

export const normalizeGitHubUrl = (input: string): string => {
  if (input.length === 0) {
    return "";
  }

  if (input.startsWith("git@github.com:")) {
    return `https://github.com/${stripGitSuffix(input.slice("git@github.com:".length))}`;
  }

  if (input.startsWith("git+https://github.com/")) {
    return stripGitSuffix(input.slice("git+".length));
  }

  if (input.startsWith("https://github.com/")) {
    return stripGitSuffix(input);
  }

  return input;
};

export const stripPackageScope = (packageName: string): string =>
  packageName.replace(packageScopeRegex, "");
