import packageJson from "../../package.json" with { type: "json" };
import type { NodeTarget } from "../node-target.js";

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

const templateOnlyGeneratedPackageDependencies = {
  // Used only in scaffolded projects; the generator does not import this at runtime.
  meow: "^14.1.0",
} as const satisfies DependencySection;

export const generatedPackageDependencies = {
  ...templateOnlyGeneratedPackageDependencies,
  zod: readDependencySpecifier(dependencies, "zod"),
} as const satisfies Record<string, string>;

const templateOnlyGeneratedPackageDevDependencies = {
  // Used only in scaffolded projects; the generator neither imports nor runs
  // these itself, so they are pinned here rather than installed as real
  // devDependencies.
  jsr: "^0.14.3",
  tsdown: "^0.22.14",
} as const satisfies DependencySection;

export const generatedPackageDevDependencies = {
  ...templateOnlyGeneratedPackageDevDependencies,
  "@arethetypeswrong/cli": readDependencySpecifier(devDependencies, "@arethetypeswrong/cli"),
  "@biomejs/biome": readDependencySpecifier(devDependencies, "@biomejs/biome"),
  "@sindresorhus/tsconfig": readDependencySpecifier(devDependencies, "@sindresorhus/tsconfig"),
  "@vitest/coverage-v8": readDependencySpecifier(devDependencies, "@vitest/coverage-v8"),
  fallow: readDependencySpecifier(devDependencies, "fallow"),
  lefthook: readDependencySpecifier(devDependencies, "lefthook"),
  oxfmt: readDependencySpecifier(devDependencies, "oxfmt"),
  oxlint: readDependencySpecifier(devDependencies, "oxlint"),
  publint: readDependencySpecifier(devDependencies, "publint"),
  typescript: readDependencySpecifier(devDependencies, "typescript"),
  vitest: readDependencySpecifier(devDependencies, "vitest"),
} as const satisfies Record<string, string>;

const nodeTypesSpecifierPattern = /^\^(\d+)\./u;

/**
 * Template-only like the pins above, but keyed by target rather than flat:
 * @types/node majors track Node majors and type the whole surface of their
 * line, so the pin has to equal the `engines.node` floor emitted from the same
 * config. A floor of ">=24" paired with 26.x types lets a generated project
 * typecheck against APIs its own engines field promises to run without
 * (URLPattern, for instance, only became a Node global in 24). A project's
 * typecheck runs once, so its CI matrix cannot catch that; only matching the
 * majors can.
 *
 * Node 25 is unreachable by construction: it is absent from `NodeTarget`, and
 * the assertion below refuses any specifier whose major disagrees with its own
 * key. Adding a 25.x pin therefore takes a visible change to the union.
 */
const nodeTypesVersionByTarget = {
  "24": "^24.13.3",
  "26": "^26.1.2",
} as const satisfies Record<NodeTarget, string>;

const assertNodeTypesMajorsMatchTargets = (versionByTarget: Record<string, string>): void => {
  for (const [nodeTarget, specifier] of Object.entries(versionByTarget)) {
    if (nodeTypesSpecifierPattern.exec(specifier)?.[1] !== nodeTarget) {
      throw new Error(
        `@types/node pin for Node ${nodeTarget} must be a caret range on the ${nodeTarget}.x line; got ${specifier}`,
      );
    }
  }
};

assertNodeTypesMajorsMatchTargets(nodeTypesVersionByTarget);

export { nodeTypesVersionByTarget };

// Widened on purpose. Indexing a `Record<NodeTarget, string>` by a `NodeTarget`
// is `string`, so the guard below would be dead code TypeScript rejects -- yet
// `scripts/smoke-test-scaffold.mjs` is untyped JS calling the compiled output,
// where an omitted `nodeTarget` would otherwise emit `"@types/node": undefined`
// and have `JSON.stringify` drop the key entirely.
const nodeTypesVersionLookup: Readonly<Record<string, string | undefined>> =
  nodeTypesVersionByTarget;

export const nodeTypesVersion = (nodeTarget: NodeTarget): string => {
  const specifier = nodeTypesVersionLookup[nodeTarget];
  if (specifier === undefined) {
    throw new Error(`No @types/node pin for Node target ${nodeTarget}`);
  }

  return specifier;
};

export const githubActionRefs = {
  checkout: "actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3",
  codecov: "codecov/codecov-action@fb8b3582c8e4def4969c97caa2f19720cb33a72f # v7.0.0",
  codeqlAnalyze: "github/codeql-action/analyze@8aad20d150bbac5944a9f9d289da16a4b0d87c1e # v4.36.2",
  codeqlInit: "github/codeql-action/init@8aad20d150bbac5944a9f9d289da16a4b0d87c1e # v4.36.2",
  codeqlUploadSarif:
    "github/codeql-action/upload-sarif@8aad20d150bbac5944a9f9d289da16a4b0d87c1e # v4.36.2",
  pnpmSetup: "pnpm/action-setup@0e279bb959325dab635dd2c09392533439d90093 # v6.0.8",
  scorecard: "ossf/scorecard-action@4eaacf0543bb3f2c246792bd56e8cdeffafb205a # v2.4.3",
  setupNode: "actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0",
  setupUv: "astral-sh/setup-uv@fac544c07dec837d0ccb6301d7b5580bf5edae39 # v8.2.0",
} as const satisfies Record<string, string>;

export const semgrepVersion = "1.172.0";
