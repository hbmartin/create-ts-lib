import { readFileSync } from "node:fs";

import { normalizeGitHubUrl, stripPackageScope } from "../name-helpers.js";
import { renderBiomeJsonc } from "./biome.js";

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
  license: LicenseName;
  packageManager: PackageManager;
  projectName: string;
}

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

const pnpmVersion = "11.5.2";

export const tsgoProbeCommand =
  "pnpm --package @typescript/native-preview@7.0.0-dev.20260421.2 dlx tsgo -p tsconfig.json --noEmit";

const readTemplate = (relativePath: string): string =>
  readFileSync(new URL(`./assets/${relativePath}`, import.meta.url), "utf8");

const renderTemplate = (
  relativePath: string,
  replacements: Record<string, string> = {},
): string => {
  let content = readTemplate(relativePath);

  for (const [key, value] of Object.entries(replacements)) {
    content = content.replaceAll(`{{${key}}}`, value);
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
      format: "oxfmt . --write",
      lint: "biome check --error-on-warnings . && oxlint --deny-warnings . && oxfmt --check .",
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
      ...(config.includeCli ? { meow: "^14.0.0" } : {}),
      zod: "^4.4.3",
    },
    devDependencies: {
      "@arethetypeswrong/cli": "^0.18.3",
      "@biomejs/biome": "^2.4.16",
      "@sindresorhus/tsconfig": "^8.1.0",
      "@types/node": "^22",
      "@vitest/coverage-v8": "^4.1.8",
      "dependency-cruiser": "^17.4.3",
      lefthook: "^2.1.9",
      oxfmt: "^0.53.0",
      oxlint: "^1.68.0",
      publint: "^0.3.21",
      typescript: "^6.0.3",
      vitest: "^4.1.8",
    },
    resolutions: {
      "@types/node": "^22",
    },
    engines: {
      node: ">=22",
    },
  };

  return `${JSON.stringify(packageJson, null, 2)}\n`;
};

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

\`${pmConfig.runPrefix} security:lint\` prefers \`semgrep\` on PATH and otherwise runs the pinned \`uvx semgrep@1.165.0\` scan.

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
        uses: codecov/codecov-action@fb8b3582c8e4def4969c97caa2f19720cb33a72f # v7.0.0
        with:
          token: \${{ secrets.CODECOV_TOKEN }}
          fail_ci_if_error: true`
    : "";

  return renderTemplate("github/ci.yml.tmpl", {
    AUDIT_COMMAND: "pnpm audit --prod",
    BUILD_COMMAND: "pnpm run build",
    CACHE: "pnpm",
    CODECOV_STEP: codecovStep,
    INSTALL_CI_COMMAND: "pnpm install --frozen-lockfile",
    PACKAGE_MANAGER_SETUP: `      - uses: pnpm/action-setup@0e279bb959325dab635dd2c09392533439d90093 # v6.0.8
        with:
          version: ${pnpmVersion}`,
    PUBLINT_COMMAND: "pnpm run publint",
    RUN_PREFIX: "pnpm run",
    TSGO_PROBE_COMMAND: tsgoProbeCommand,
  });
};

const buildReleaseWorkflow = (): string => renderTemplate("github/release.yml.tmpl");

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
    {
      content: renderBiomeJsonc(config.includeCli),
      path: "biome.jsonc",
    },
    {
      content: renderTemplate("agents.md.tmpl"),
      path: "AGENTS.md",
    },
    {
      content: renderTemplate("dependency-cruiser.cjs.tmpl"),
      path: ".dependency-cruiser.cjs",
    },
    {
      content: renderTemplate("oxfmtrc.json.tmpl"),
      path: ".oxfmtrc.json",
    },
    {
      content: renderTemplate("oxlintrc.json.tmpl"),
      path: ".oxlintrc.json",
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
      content: renderTemplate("scripts/security-lint.mjs.tmpl"),
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
