import type { LintFormatTooling } from "../lint-format-tooling.js";
import { normalizeGitHubUrl } from "../name-helpers.js";
import {
  generatedPackageDependencies,
  generatedPackageDevDependencies,
  pnpmVersion,
} from "./generated-versions.js";
import {
  getBinName,
  type PackageManager,
  packageManagerConfig,
  type ScaffoldConfig,
} from "./scaffold-config.js";

interface RepositoryMetadata {
  bugs: {
    url: string;
  };
  homepage: string;
  repository: {
    type: "git";
    url: string;
  };
}

const repositoryFields = (githubRepoUrl: string): RepositoryMetadata | undefined => {
  if (githubRepoUrl.length === 0) {
    return undefined;
  }

  const normalizedUrl = normalizeGitHubUrl(githubRepoUrl);
  return {
    bugs: {
      url: `${normalizedUrl}/issues`,
    },
    homepage: `${normalizedUrl}#readme`,
    repository: {
      type: "git",
      url: `git+${normalizedUrl}.git`,
    },
  };
};

const packageManagerDlxCommand = {
  npm: "npx",
  pnpm: "pnpm dlx",
  yarn: "yarn dlx",
} satisfies Record<PackageManager, string>;

const buildBundlerScripts = (config: ScaffoldConfig): { build: string; dev: string } =>
  config.bundler === "tsdown"
    ? { build: "tsdown", dev: "tsdown --watch" }
    : { build: "tsc -p tsconfig.build.json", dev: "tsc --watch" };

export const buildPackageJson = (config: ScaffoldConfig): string => {
  const pmConfig = packageManagerConfig[config.packageManager];
  const lintFormatScripts = buildLintFormatScripts(config.lintFormatTooling);
  const bundlerScripts = buildBundlerScripts(config);
  const repositoryMetadata = repositoryFields(config.githubRepoUrl);
  const artifactFiles = [
    "dist/index.js",
    "dist/index.d.ts",
    ...(config.includeCli ? ["dist/cli.js", "dist/cli.d.ts"] : []),
  ];
  const artifactFilesLiteral = JSON.stringify(artifactFiles).replaceAll('"', "'");
  const verifyArtifactsScript = `node -e "for (const file of ${artifactFilesLiteral}) require('node:fs').statSync(file)"`;
  const packageJson = {
    name: config.projectName,
    version: "0.1.0",
    description: config.description,
    ...(repositoryMetadata
      ? {
          homepage: repositoryMetadata.homepage,
          bugs: repositoryMetadata.bugs,
        }
      : {}),
    license: config.license,
    author: config.author,
    ...(repositoryMetadata ? { repository: repositoryMetadata.repository } : {}),
    ...(config.includeCli
      ? {
          bin: {
            [getBinName(config.projectName)]: "dist/cli.js",
          },
        }
      : {}),
    files: ["dist"],
    type: "module",
    ...(config.packageManager === "pnpm" ? { packageManager: `pnpm@${pnpmVersion}` } : {}),
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        default: "./dist/index.js",
      },
    },
    scripts: {
      build: bundlerScripts.build,
      check: `${pmConfig.runPrefix} lint && ${pmConfig.runPrefix} typecheck && ${pmConfig.runPrefix} deps:lint && ${pmConfig.runPrefix} security:lint && ${pmConfig.runPrefix} test:coverage`,
      "deps:lint": "depcruise --config .dependency-cruiser.cjs source test",
      dev: bundlerScripts.dev,
      format: lintFormatScripts.format,
      lint: lintFormatScripts.lint,
      attw: "attw --pack . --profile esm-only",
      ...(config.includeJsr
        ? { "jsr:publish": `${packageManagerDlxCommand[config.packageManager]} jsr publish` }
        : {}),
      prepare: "lefthook install",
      prepublishOnly: `${pmConfig.runPrefix} check && ${pmConfig.runPrefix} build && ${pmConfig.runPrefix} verify:artifacts && ${pmConfig.runPrefix} publint && ${pmConfig.runPrefix} types:lint`,
      publint: `publint --pack ${config.packageManager}`,
      "release:check": `${pmConfig.runPrefix} prepublishOnly && ${pmConfig.runPrefix} verify:package`,
      "security:lint": "node scripts/security-lint.mjs",
      "size:report": "npm pack --dry-run --json",
      test: "vitest run",
      "test:coverage": "vitest run --coverage",
      typecheck: "tsc --noEmit",
      "types:lint": "attw --pack . --profile esm-only",
      "verify:artifacts": verifyArtifactsScript,
      "verify:package": "npm publish --dry-run --ignore-scripts",
    },
    dependencies: {
      ...(config.includeCli ? { meow: generatedPackageDependencies.meow } : {}),
      ...(config.includeZod ? { zod: generatedPackageDependencies.zod } : {}),
    },
    devDependencies: {
      "@arethetypeswrong/cli": generatedPackageDevDependencies["@arethetypeswrong/cli"],
      "@sindresorhus/tsconfig": generatedPackageDevDependencies["@sindresorhus/tsconfig"],
      "@types/node": generatedPackageDevDependencies["@types/node"],
      "@vitest/coverage-v8": generatedPackageDevDependencies["@vitest/coverage-v8"],
      "dependency-cruiser": generatedPackageDevDependencies["dependency-cruiser"],
      lefthook: generatedPackageDevDependencies.lefthook,
      ...buildLintFormatDevDependencies(config.lintFormatTooling),
      publint: generatedPackageDevDependencies.publint,
      ...(config.bundler === "tsdown" ? { tsdown: generatedPackageDevDependencies.tsdown } : {}),
      typescript: generatedPackageDevDependencies.typescript,
      vitest: generatedPackageDevDependencies.vitest,
    },
    ...buildPackageManagerOverrideFields(config.packageManager),
    engines: {
      node: ">=22",
    },
  };

  return `${JSON.stringify(packageJson, null, 2)}\n`;
};

const buildPackageManagerOverrideFields = (
  packageManager: PackageManager,
): PackageManagerOverrideFields => packageManagerOverrideFields[packageManager];

type PackageManagerOverrideFields =
  | { overrides: { "@types/node": string } }
  | { pnpm: { overrides: { "@types/node": string } } }
  | { resolutions: { "@types/node": string } };

const packageManagerOverrideFields = {
  npm: {
    overrides: {
      "@types/node": generatedPackageDevDependencies["@types/node"],
    },
  },
  pnpm: {
    pnpm: {
      overrides: {
        "@types/node": generatedPackageDevDependencies["@types/node"],
      },
    },
  },
  yarn: {
    resolutions: {
      "@types/node": generatedPackageDevDependencies["@types/node"],
    },
  },
} satisfies Record<PackageManager, PackageManagerOverrideFields>;

const lintFormatScripts = {
  biome: {
    format: "biome format --write .",
    lint: "biome check --error-on-warnings .",
  },
  "oxlint-oxfmt": {
    format: "oxfmt . --write",
    lint: "oxlint --deny-warnings . && oxfmt --check .",
  },
} satisfies Record<LintFormatTooling, { format: string; lint: string }>;

const buildLintFormatScripts = (
  lintFormatTooling: LintFormatTooling,
): { format: string; lint: string } => lintFormatScripts[lintFormatTooling];

const lintFormatDevDependencies = {
  biome: {
    "@biomejs/biome": generatedPackageDevDependencies["@biomejs/biome"],
  },
  "oxlint-oxfmt": {
    oxfmt: generatedPackageDevDependencies.oxfmt,
    oxlint: generatedPackageDevDependencies.oxlint,
  },
} satisfies Record<LintFormatTooling, Record<string, string>>;

const buildLintFormatDevDependencies = (
  lintFormatTooling: LintFormatTooling,
): Record<string, string> => lintFormatDevDependencies[lintFormatTooling];
