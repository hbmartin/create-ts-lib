import { readFileSync } from "node:fs";

import { renderBiomeJsonc } from "./biome.js";

export type PackageManager = "pnpm" | "npm" | "yarn";
export type LicenseName = "MIT" | "ISC" | "Apache-2.0" | "UNLICENSED";
const authorNameRegex = /^(.*?)\s*</u;
const gitSuffixRegex = /\.git$/u;
const packageScopeRegex = /^@[^/]+\//u;

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
  auditCommand: string;
  buildCommand: string;
  cache: string;
  installCiCommand: string;
  installCommand: string;
  packageManagerSetup: string;
  publintCommand: string;
  runPrefix: string;
}

const packageManagerConfig = {
  npm: {
    auditCommand: "npm audit --omit=dev",
    buildCommand: "npm run build",
    cache: "npm",
    installCiCommand: "npm ci",
    installCommand: "npm install",
    packageManagerSetup: "      - run: corepack enable",
    publintCommand: "npx --no -- publint --pack npm",
    runPrefix: "npm run",
  },
  pnpm: {
    auditCommand: "pnpm audit --prod",
    buildCommand: "pnpm run build",
    cache: "pnpm",
    installCiCommand: "pnpm install --frozen-lockfile",
    installCommand: "pnpm install",
    packageManagerSetup: `      - uses: pnpm/action-setup@f40ffcd9367d9f12939873eb1018b921a783ffaa # v4
        with:
          version: 11.5.2`,
    publintCommand: "pnpm exec publint --pack npm",
    runPrefix: "pnpm run",
  },
  yarn: {
    auditCommand: "yarn audit --groups dependencies",
    buildCommand: "yarn run build",
    cache: "yarn",
    installCiCommand: "yarn install --frozen-lockfile",
    installCommand: "yarn install",
    packageManagerSetup: "      - run: corepack enable",
    publintCommand: "yarn publint --pack npm",
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

  const normalizedUrl = githubRepoUrl.replace(gitSuffixRegex, "");
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
  const repositoryMetadata = repositoryFields(config.githubRepoUrl);
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
      dev: "tsc --watch",
      format: "oxfmt . --write",
      lint: "biome check --error-on-warnings . && oxlint --deny-warnings . && oxfmt --check .",
      prepare: "lefthook install",
      test: "vitest run --coverage",
      typecheck: "tsc --noEmit",
    },
    dependencies: {
      ...(config.includeCli ? { meow: "^14.0.0" } : {}),
      zod: "^4.4.3",
    },
    devDependencies: {
      "@biomejs/biome": "^2.4.16",
      "@sindresorhus/tsconfig": "^8.1.0",
      "@types/node": "^22",
      "@vitest/coverage-v8": "^4.1.8",
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

const buildCiWorkflow = (config: ScaffoldConfig): string => {
  const pmConfig = packageManagerConfig[config.packageManager];
  const codecovStep = config.includeCodecov
    ? `
      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@75cd11691c0faa626561e295848008c8a7dddffe # v5
        with:
          token: \${{ secrets.CODECOV_TOKEN }}
          fail_ci_if_error: true`
    : "";

  return renderTemplate("github/ci.yml.tmpl", {
    AUDIT_COMMAND: pmConfig.auditCommand,
    BUILD_COMMAND: pmConfig.buildCommand,
    CACHE: pmConfig.cache,
    CODECOV_STEP: codecovStep,
    INSTALL_CI_COMMAND: pmConfig.installCiCommand,
    PACKAGE_MANAGER_SETUP: pmConfig.packageManagerSetup,
    PUBLINT_COMMAND: pmConfig.publintCommand,
    RUN_PREFIX: pmConfig.runPrefix,
  });
};

const buildLicense = (license: LicenseName, author: string): string => {
  const year = new Date().getUTCFullYear().toString();
  const authorName = extractAuthorName(author);
  const licenseTemplatePath = `licenses/${license.toLowerCase()}.txt.tmpl`;

  return renderTemplate(licenseTemplatePath, {
    AUTHOR_NAME: authorName,
    YEAR: year,
  });
};

export const getBinName = (projectName: string): string =>
  projectName.replace(packageScopeRegex, "");

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
      content: buildPackageJson(config),
      path: "package.json",
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

  if (config.githubRepoUrl.length > 0) {
    files.push(
      {
        content: buildCiWorkflow(config),
        path: ".github/workflows/ci.yml",
      },
      {
        content: renderTemplate("github/semantic-pr.yml.tmpl"),
        path: ".github/workflows/semantic-pr.yml",
      },
    );
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
