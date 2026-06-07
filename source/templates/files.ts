import { readFileSync } from "node:fs";

import { stripGitSuffix, stripPackageScope } from "../name-helpers.js";
import { renderBiomeJsonc } from "./biome.js";

export type PackageManager = "pnpm" | "npm" | "yarn";
export type LicenseName = "MIT" | "ISC" | "Apache-2.0" | "UNLICENSED";
const authorNameRegex = /^(.*?)\s*</u;

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

  const normalizedUrl = stripGitSuffix(githubRepoUrl);
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
  const artifactFilesLiteral = `[${artifactFiles.map((file) => `'${file}'`).join(",")}]`;
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
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        default: "./dist/index.js",
      },
    },
    scripts: {
      build: "tsc -p tsconfig.build.json",
      check: `${pmConfig.runPrefix} lint && ${pmConfig.runPrefix} deps:lint && ${pmConfig.runPrefix} security:lint && ${pmConfig.runPrefix} typecheck && ${pmConfig.runPrefix} test`,
      "deps:lint": "depcruise --config .dependency-cruiser.cjs source test",
      dev: "tsc --watch",
      format: "oxfmt . --write",
      lint: "biome check --error-on-warnings . && oxlint --deny-warnings . && oxfmt --check .",
      attw: "attw --pack . --profile esm-only",
      prepare: "lefthook install",
      prepublishOnly: `${pmConfig.runPrefix} check && ${pmConfig.runPrefix} build && ${pmConfig.runPrefix} verify:artifacts && ${pmConfig.runPrefix} publint && ${pmConfig.runPrefix} types:lint`,
      publint: `publint --pack ${config.packageManager}`,
      "release:check": `${pmConfig.runPrefix} prepublishOnly && ${pmConfig.runPrefix} verify:package`,
      "security:lint": "semgrep scan --config semgrep.yml --error source test",
      "size:report": "npm pack --dry-run --json",
      test: "vitest run --coverage",
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

${buildLicenseBadge(config.license)}

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

\`\`\`bash
${pmConfig.runPrefix} check
${pmConfig.runPrefix} release:check
\`\`\`

## License

${config.license} - ${authorName}.
`;
};

const buildLicenseBadge = (license: LicenseName): string => {
  const escapedLicense = license.replaceAll("-", "--");

  return `[![License: ${license}](https://img.shields.io/badge/license-${escapedLicense}-blue.svg)](LICENSE)`;
};

const buildCiWorkflow = (config: ScaffoldConfig): string => {
  const codecovStep = config.includeCodecov
    ? `
      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@75cd11691c0faa626561e295848008c8a7dddffe # v5
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
    PACKAGE_MANAGER_SETUP: `      - uses: pnpm/action-setup@f40ffcd9367d9f12939873eb1018b921a783ffaa # v4
        with:
          version: 11.5.2`,
    PUBLINT_COMMAND: "pnpm exec publint --pack pnpm",
    RUN_PREFIX: "pnpm run",
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
  }

  if (config.githubRepoUrl.length > 0 && config.packageManager === "pnpm") {
    files.push({
      content: buildCiWorkflow(config),
      path: ".github/workflows/ci.yml",
    });
    files.push({
      content: buildReleaseWorkflow(),
      path: ".github/workflows/release.yml",
    });
  }

  return files;
};

const extractAuthorName = (author: string): string => {
  const match = authorNameRegex.exec(author);
  if (match?.[1]?.trim().length) {
    return match[1].trim();
  }

  return author || "Unknown Author";
};
