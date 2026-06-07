const maximumPackageNameLength = 214;
const packageSegmentRegex = /^(?![._])[a-z0-9._-]+$/u;
const scopedPackageNameRegex = /^@([^/]+)\/([^/]+)$/u;
const whitespaceRegex = /\s/u;

export interface PackageNameValidationResult {
  errors: string[];
  valid: boolean;
}

export const validatePackageName = (packageName: string): PackageNameValidationResult => {
  const errors: string[] = [];

  if (packageName.length === 0) {
    errors.push("Package name is required.");
  }

  if (packageName.length > maximumPackageNameLength) {
    errors.push(`Package name must be ${maximumPackageNameLength} characters or fewer.`);
  }

  if (packageName.trim() !== packageName || whitespaceRegex.test(packageName)) {
    errors.push("Package name must not contain whitespace.");
  }

  if (packageName !== packageName.toLowerCase()) {
    errors.push("Package name must be lowercase.");
  }

  const segments = getPackageNameSegments(packageName);
  if (!segments) {
    errors.push("Scoped package names must use the form @scope/name.");
  } else {
    for (const segment of segments) {
      if (segment.length === 0) {
        errors.push("Package name segments must not be empty.");
        continue;
      }

      if (!packageSegmentRegex.test(segment)) {
        errors.push(
          "Package name segments may contain only lowercase letters, numbers, dots, underscores, and hyphens, and must not start with a dot or underscore.",
        );
      }
    }
  }

  return {
    errors: [...new Set(errors)],
    valid: errors.length === 0,
  };
};

export const assertValidPackageName = (packageName: string): void => {
  const validation = validatePackageName(packageName);

  if (!validation.valid) {
    throw new Error(`Invalid project name "${packageName}": ${validation.errors.join(" ")}`);
  }
};

const getPackageNameSegments = (packageName: string): string[] | undefined => {
  if (!packageName.startsWith("@")) {
    return [packageName];
  }

  const scopedNameMatch = scopedPackageNameRegex.exec(packageName);
  if (!scopedNameMatch) {
    return undefined;
  }

  return [scopedNameMatch[1] ?? "", scopedNameMatch[2] ?? ""];
};
