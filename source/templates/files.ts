import { readFileSync } from "node:fs";

import { defaultLintFormatTooling, type LintFormatTooling } from "../lint-format-tooling.js";
import { normalizeGitHubUrl, stripPackageScope } from "../name-helpers.js";
import { renderBiomeJsonc } from "./biome.js";
import {
  generatedPackageDependencies,
  generatedPackageDevDependencies,
  githubActionRefs,
  pnpmVersion,
  semgrepVersion,
  tsgoProbeCommand,
} from "./generated-versions.js";

export { tsgoProbeCommand } from "./generated-versions.js";

export type PackageManager = "pnpm" | "npm" | "yarn";
export type LicenseName = "MIT" | "ISC" | "Apache-2.0" | "UNLICENSED";

/**
 * Options that control the files emitted for a generated TypeScript library.
 */
export interface ScaffoldConfig {
  author: string;
  description: string;
  githubRepoUrl: string;
  includeCli: boolean;
  includeCodecov: boolean;
  includeZod: boolean;
  license: LicenseName;
  lintFormatTooling: LintFormatTooling;
  packageManager: PackageManager;
  projectName: string;
}

export const defaultScaffoldConfig = (overrides: Partial<ScaffoldConfig> = {}): ScaffoldConfig => ({
  author: "",
  description: "",
  githubRepoUrl: "",
  includeCli: false,
  includeCodecov: true,
  includeZod: false,
  license: "Apache-2.0",
  lintFormatTooling: defaultLintFormatTooling,
  packageManager: "pnpm",
  projectName: "my-lib",
  ...overrides,
});

export interface GeneratedFile {
  content: string;
  executable?: boolean;
  path: string;
}

interface PackageManagerConfig {
  addCommand: string;
  runPrefix: string;
}

const packageManagerConfig = {
  npm: {
    addCommand: "npm install",
    runPrefix: "npm run",
  },
  pnpm: {
    addCommand: "pnpm add",
    runPrefix: "pnpm run",
  },
  yarn: {
    addCommand: "yarn add",
    runPrefix: "yarn run",
  },
} satisfies Record<PackageManager, PackageManagerConfig>;

const readTemplate = (relativePath: string): string =>
  readFileSync(new URL(`./assets/${relativePath}`, import.meta.url), "utf8");

const unresolvedTemplatePlaceholderPattern = /(?<!\$)\{\{[^{}]*\}\}/gu;

export const renderTemplate = (
  relativePath: string,
  replacements: Record<string, string> = {},
): string => {
  let content = readTemplate(relativePath);

  for (const [key, value] of Object.entries(replacements)) {
    content = content.replaceAll(`{{${key}}}`, value);
  }

  const unresolvedPlaceholders = Array.from(
    new Set(content.match(unresolvedTemplatePlaceholderPattern) ?? []),
  );
  if (unresolvedPlaceholders.length > 0) {
    throw new Error(
      `Unresolved template placeholder(s) in ${relativePath}: ${unresolvedPlaceholders.join(", ")}`,
    );
  }

  return content;
};

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

const buildPackageJson = (config: ScaffoldConfig): string => {
  const pmConfig = packageManagerConfig[config.packageManager];
  const lintFormatScripts = buildLintFormatScripts(config.lintFormatTooling);
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
      build: "tsc -p tsconfig.build.json",
      check: `${pmConfig.runPrefix} lint && ${pmConfig.runPrefix} typecheck && ${pmConfig.runPrefix} deps:lint && ${pmConfig.runPrefix} security:lint && ${pmConfig.runPrefix} test:coverage`,
      "deps:lint": "depcruise --config .dependency-cruiser.cjs source test",
      dev: "tsc --watch",
      format: lintFormatScripts.format,
      lint: lintFormatScripts.lint,
      attw: "attw --pack . --profile esm-only",
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

const buildReadme = (config: ScaffoldConfig): string => {
  const pmConfig = packageManagerConfig[config.packageManager];
  const description = config.description || "A TypeScript library.";
  const authorName = extractAuthorName(config.author);
  const cliSection = config.includeCli
    ? `
## CLI

\`\`\`bash
${getBinName(config.projectName)} --help
\`\`\`
`
    : "";

  return `# \`${config.projectName}\`

${buildReadmeBadges(config)}

${description}

## Install

\`\`\`bash
${pmConfig.addCommand} ${config.projectName}
\`\`\`

## Usage

\`\`\`ts
import { formatValue } from "${config.projectName}";

const output = formatValue({ ready: true });
\`\`\`
${cliSection}
## Development

Lint, format, type-check, dependency and security policy checks, and tests are
wired into a single command:

\`\`\`bash
${pmConfig.runPrefix} check         # lint + dep/security checks + typecheck + coverage
${pmConfig.runPrefix} test          # run tests
${pmConfig.runPrefix} build         # build to dist/
${pmConfig.runPrefix} release:check # package validation + publish dry run
\`\`\`

\`${pmConfig.runPrefix} security:lint\` prefers \`semgrep\` on PATH and otherwise runs the pinned \`uvx semgrep@${semgrepVersion}\` scan.

See [\`AGENTS.md\`](AGENTS.md) for the conventions this project follows.

## License

[${config.license}](LICENSE) © ${authorName}.
`;
};

const buildReadmeBadges = (config: ScaffoldConfig): string => {
  const badges = [
    `[![npm version](https://img.shields.io/npm/v/${config.projectName}.svg)](https://www.npmjs.com/package/${config.projectName})`,
  ];

  if (config.githubRepoUrl.length > 0 && config.packageManager === "pnpm") {
    const normalizedUrl = normalizeGitHubUrl(config.githubRepoUrl);
    badges.push(
      `[![CI](${normalizedUrl}/actions/workflows/ci.yml/badge.svg)](${normalizedUrl}/actions/workflows/ci.yml)`,
    );
  }

  badges.push(buildLicenseBadge(config.license));

  return badges.join("\n");
};

const buildLicenseBadge = (license: LicenseName): string => {
  const escapedLicense = license.replaceAll("-", "--");

  return `[![License: ${license}](https://img.shields.io/badge/license-${escapedLicense}-blue.svg)](LICENSE)`;
};

const buildCiWorkflow = (config: ScaffoldConfig): string => {
  const codecovStep = config.includeCodecov
    ? `
      - name: Upload coverage to Codecov
        if: matrix.node-version == '24'
        uses: ${githubActionRefs.codecov}
        with:
          token: \${{ secrets.CODECOV_TOKEN }}
          fail_ci_if_error: true`
    : "";

  return renderTemplate("github/ci.yml.tmpl", {
    ACTION_CHECKOUT: githubActionRefs.checkout,
    ACTION_SETUP_NODE: githubActionRefs.setupNode,
    ACTION_SETUP_UV: githubActionRefs.setupUv,
    AUDIT_COMMAND: "pnpm audit --prod",
    BUILD_COMMAND: "pnpm run build",
    CACHE: "pnpm",
    CODECOV_STEP: codecovStep,
    INSTALL_CI_COMMAND: "pnpm install --frozen-lockfile",
    PACKAGE_MANAGER_SETUP: `      - uses: ${githubActionRefs.pnpmSetup}
        with:
          version: ${pnpmVersion}`,
    PUBLINT_COMMAND: "pnpm run publint",
    RUN_PREFIX: "pnpm run",
    TSGO_PROBE_COMMAND: tsgoProbeCommand,
  });
};

const buildReleaseWorkflow = (): string =>
  renderTemplate("github/release.yml.tmpl", {
    ACTION_CHECKOUT: githubActionRefs.checkout,
    ACTION_PNPM_SETUP: githubActionRefs.pnpmSetup,
    ACTION_SETUP_NODE: githubActionRefs.setupNode,
    ACTION_SETUP_UV: githubActionRefs.setupUv,
    PNPM_VERSION: pnpmVersion,
  });

const buildLicense = (license: LicenseName, author: string): string => {
  const year = new Date().getUTCFullYear().toString();
  const authorName = extractAuthorName(author);
  const licenseTemplatePath = `licenses/${license.toLowerCase()}.txt.tmpl`;

  return renderTemplate(licenseTemplatePath, {
    AUTHOR_NAME: authorName,
    YEAR: year,
  });
};

export const getBinName = (projectName: string): string => stripPackageScope(projectName);

export const buildProjectFiles = (config: ScaffoldConfig): GeneratedFile[] => {
  const pmConfig = packageManagerConfig[config.packageManager];
  const files: GeneratedFile[] = [
    {
      content: renderTemplate("gitignore.tmpl"),
      path: ".gitignore",
    },
    ...buildLintFormatFiles(config),
    {
      content: renderTemplate("agents.md.tmpl", {
        LINT_FORMAT_GUIDANCE: buildLintFormatAgentGuidance(config.lintFormatTooling),
        SEMGREP_VERSION: semgrepVersion,
        ZOD_GUIDANCE: buildZodAgentGuidance(config.includeZod),
      }),
      path: "AGENTS.md",
    },
    {
      content: renderTemplate("dependency-cruiser.cjs.tmpl"),
      path: ".dependency-cruiser.cjs",
    },
    {
      content: renderTemplate("lefthook.yml.tmpl", {
        RUN_PREFIX: pmConfig.runPrefix,
      }),
      path: "lefthook.yml",
    },
    {
      content: renderTemplate("semgrep.yml.tmpl"),
      path: "semgrep.yml",
    },
    {
      content: renderTemplate("scripts/security-lint.mjs.tmpl", {
        SEMGREP_VERSION: semgrepVersion,
      }),
      path: "scripts/security-lint.mjs",
    },
    {
      content: buildPackageJson(config),
      path: "package.json",
    },
    {
      content: buildReadme(config),
      path: "README.md",
    },
    ...(config.packageManager === "pnpm"
      ? [
          {
            content: renderTemplate("pnpm-workspace.yaml.tmpl"),
            path: "pnpm-workspace.yaml",
          },
        ]
      : []),
    {
      content: renderTemplate("tsconfig.json.tmpl"),
      path: "tsconfig.json",
    },
    {
      content: renderTemplate("tsconfig.build.json.tmpl"),
      path: "tsconfig.build.json",
    },
    {
      content: renderTemplate("vitest.config.ts.tmpl"),
      path: "vitest.config.ts",
    },
    {
      content: buildLicense(config.license, config.author),
      path: "LICENSE",
    },
    {
      content: renderTemplate("source/index.ts.tmpl"),
      path: "source/index.ts",
    },
    {
      content: renderTemplate("source/types/index.ts.tmpl"),
      path: "source/types/index.ts",
    },
    {
      content: renderTemplate("source/utils/formatting.ts.tmpl"),
      path: "source/utils/formatting.ts",
    },
    {
      content: renderTemplate("test/utils/formatting.test.ts.tmpl"),
      path: "test/utils/formatting.test.ts",
    },
  ];

  if (config.includeCli) {
    files.push({
      content: renderTemplate("source/cli.ts.tmpl", {
        BIN_NAME: getBinName(config.projectName),
      }),
      executable: true,
      path: "source/cli.ts",
    });
    files.push({
      content: renderTemplate("test/cli.test.ts.tmpl", {
        BIN_NAME: getBinName(config.projectName),
      }),
      path: "test/cli.test.ts",
    });
  }

  if (config.githubRepoUrl.length > 0 && config.packageManager === "pnpm") {
    files.push(
      {
        content: buildCiWorkflow(config),
        path: ".github/workflows/ci.yml",
      },
      {
        content: buildReleaseWorkflow(),
        path: ".github/workflows/release.yml",
      },
    );
  }

  return files;
};

const buildLintFormatFiles = (config: ScaffoldConfig): GeneratedFile[] => {
  if (config.lintFormatTooling === "biome") {
    return [
      {
        content: renderBiomeJsonc(config.includeCli),
        path: "biome.jsonc",
      },
    ];
  }

  return [
    {
      content: renderTemplate("oxfmtrc.json.tmpl"),
      path: ".oxfmtrc.json",
    },
    {
      content: renderTemplate("oxlintrc.json.tmpl"),
      path: ".oxlintrc.json",
    },
  ];
};

const lintFormatAgentGuidance = {
  biome: "Linting and formatting are handled by Biome.",
  "oxlint-oxfmt": "Linting is handled by Oxlint, and formatting is handled by Oxfmt.",
} satisfies Record<LintFormatTooling, string>;

const buildLintFormatAgentGuidance = (lintFormatTooling: LintFormatTooling): string =>
  lintFormatAgentGuidance[lintFormatTooling];

const buildZodAgentGuidance = (includeZod: boolean): string =>
  includeZod
    ? "- Use Zod for external input validation and anywhere runtime validation is needed.\n"
    : "";

const extractAuthorName = (author: string): string => {
  const trimmedAuthor = author.trim();
  const emailStartIndex = trimmedAuthor.indexOf("<");
  if (emailStartIndex >= 0) {
    const authorName = trimmedAuthor.slice(0, emailStartIndex).trim();
    if (authorName.length > 0) {
      return authorName;
    }

    const emailEndIndex = trimmedAuthor.indexOf(">", emailStartIndex + 1);
    const emailAddress = trimmedAuthor
      .slice(emailStartIndex + 1, emailEndIndex >= 0 ? emailEndIndex : undefined)
      .trim();
    if (emailAddress.length > 0) {
      return emailAddress;
    }
  }

  return trimmedAuthor || "Unknown Author";
};
