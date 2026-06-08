import packageJson from "../../package.json" with { type: "json" };

type DependencySection = Record<string, string>;

const dependencies: DependencySection = packageJson.dependencies;
const devDependencies: DependencySection = packageJson.devDependencies;

const readDependencySpecifier = (section: DependencySection, packageName: string): string => {
  const specifier = section[packageName];
  if (specifier === undefined || specifier.length === 0) {
    throw new Error(`Missing ${packageName} version in generator package.json`);
  }

  return specifier;
};

const parsePnpmVersion = (packageManager: string): string => {
  const prefix = "pnpm@";
  if (!packageManager.startsWith(prefix)) {
    throw new Error(`Expected generator packageManager to start with ${prefix}`);
  }

  const version = packageManager.slice(prefix.length);
  if (version.length === 0) {
    throw new Error("Expected generator packageManager to include a pnpm version");
  }

  return version;
};

export const pnpmVersion = parsePnpmVersion(packageJson.packageManager);

export const generatedPackageDependencies = {
  meow: readDependencySpecifier(devDependencies, "meow"),
  zod: readDependencySpecifier(dependencies, "zod"),
} as const satisfies Record<string, string>;

export const generatedPackageDevDependencies = {
  "@arethetypeswrong/cli": readDependencySpecifier(devDependencies, "@arethetypeswrong/cli"),
  "@biomejs/biome": readDependencySpecifier(devDependencies, "@biomejs/biome"),
  "@sindresorhus/tsconfig": readDependencySpecifier(devDependencies, "@sindresorhus/tsconfig"),
  "@types/node": readDependencySpecifier(devDependencies, "@types/node"),
  "@vitest/coverage-v8": readDependencySpecifier(devDependencies, "@vitest/coverage-v8"),
  "dependency-cruiser": readDependencySpecifier(devDependencies, "dependency-cruiser"),
  lefthook: readDependencySpecifier(devDependencies, "lefthook"),
  oxfmt: readDependencySpecifier(devDependencies, "oxfmt"),
  oxlint: readDependencySpecifier(devDependencies, "oxlint"),
  publint: readDependencySpecifier(devDependencies, "publint"),
  typescript: readDependencySpecifier(devDependencies, "typescript"),
  vitest: readDependencySpecifier(devDependencies, "vitest"),
} as const satisfies Record<string, string>;

export const githubActionRefs = {
  checkout: "actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3",
  codecov: "codecov/codecov-action@fb8b3582c8e4def4969c97caa2f19720cb33a72f # v7.0.0",
  pnpmSetup: "pnpm/action-setup@0e279bb959325dab635dd2c09392533439d90093 # v6.0.8",
  setupNode: "actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0",
  setupUv: "astral-sh/setup-uv@fac544c07dec837d0ccb6301d7b5580bf5edae39 # v8.2.0",
} as const satisfies Record<string, string>;

export const semgrepVersion = "1.165.0";

export const tsgoProbeCommand =
  "pnpm --package @typescript/native-preview@7.0.0-dev.20260421.2 dlx tsgo -p tsconfig.json --noEmit";
