const gitSuffixRegex = /\.git$/u;
const packageScopeRegex = /^@[^/]+\//u;

export const stripGitSuffix = (input: string): string => input.replace(gitSuffixRegex, "");

export const stripPackageScope = (packageName: string): string =>
  packageName.replace(packageScopeRegex, "");
