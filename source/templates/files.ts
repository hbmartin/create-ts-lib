import type { LintFormatTooling } from "../lint-format-tooling.js";
import { renderBiomeJsonc } from "./biome.js";
import { buildCommunityFiles } from "./community.js";
import { semgrepVersion } from "./generated-versions.js";
import { buildJsrJson } from "./jsr.js";
import { buildPackageJson } from "./package-json.js";
import { buildReadme, hasGitHubWorkflows } from "./readme.js";
import { renderTemplate } from "./render.js";
import {
  extractAuthorName,
  type GeneratedFile,
  getBinName,
  packageManagerConfig,
  type ScaffoldConfig,
} from "./scaffold-config.js";
import { assertValidScaffoldConfig, buildStateFile } from "./state.js";
import { buildVsCodeFiles } from "./vscode.js";
import {
  buildCiWorkflow,
  buildCodeqlWorkflow,
  buildReleaseWorkflow,
  buildScorecardWorkflow,
} from "./workflows.js";

export { renderTemplate } from "./render.js";
export {
  type Bundler,
  defaultScaffoldConfig,
  type GeneratedFile,
  getBinName,
  type LicenseName,
  type PackageManager,
  type ScaffoldConfig,
  type ScaffoldConfigOverrides,
} from "./scaffold-config.js";

const buildLicense = (config: ScaffoldConfig): string => {
  const authorName = extractAuthorName(config.author);
  const licenseTemplatePath = `licenses/${config.license.toLowerCase()}.txt.tmpl`;

  return renderTemplate(licenseTemplatePath, {
    AUTHOR_NAME: authorName,
    YEAR: config.copyrightYear,
  });
};

/**
 * Files a workspace root already owns. In workspace mode the parent repository
 * provides them, so emitting copies here would fight with it.
 */
const rootOwnedFiles = (config: ScaffoldConfig, build: () => GeneratedFile[]): GeneratedFile[] =>
  config.workspaceMode ? [] : build();

export const buildProjectFiles = (config: ScaffoldConfig): GeneratedFile[] => {
  assertValidScaffoldConfig(config);
  const pmConfig = packageManagerConfig[config.packageManager];
  const files: GeneratedFile[] = [
    ...rootOwnedFiles(config, () => [
      {
        content: renderTemplate("gitignore.tmpl"),
        path: ".gitignore",
      },
    ]),
    ...buildLintFormatFiles(config),
    ...rootOwnedFiles(config, () => buildVsCodeFiles(config)),
    ...buildCommunityFiles(config),
    {
      content: renderTemplate("agents.md.tmpl", {
        CLI_GUIDANCE: buildCliAgentGuidance(config.includeCli),
        LINT_FORMAT_GUIDANCE: buildLintFormatAgentGuidance(config.lintFormatTooling),
        NODE_TARGET: config.nodeTarget,
        PACKAGE_MANAGER: config.packageManager,
        RUN_PREFIX: pmConfig.runPrefix,
        ZOD_GUIDANCE: buildZodAgentGuidance(config.includeZod),
      }),
      path: "AGENTS.md",
    },
    {
      content: renderTemplate("fallowrc.jsonc.tmpl", {
        ENTRY_POINTS: config.includeCli
          ? '"source/index.ts", "source/cli.ts"'
          : '"source/index.ts"',
      }),
      path: ".fallowrc.jsonc",
    },
    ...rootOwnedFiles(config, () => [
      {
        content: renderTemplate("lefthook.yml.tmpl", {
          RUN_PREFIX: pmConfig.runPrefix,
        }),
        path: "lefthook.yml",
      },
    ]),
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
    ...rootOwnedFiles(config, () =>
      config.packageManager === "pnpm"
        ? [
            {
              content: renderTemplate("pnpm-workspace.yaml.tmpl"),
              path: "pnpm-workspace.yaml",
            },
          ]
        : [],
    ),
    {
      content: renderTemplate("tsconfig.json.tmpl"),
      path: "tsconfig.json",
    },
    ...buildBundlerFiles(config),
    {
      content: renderTemplate("vitest.config.ts.tmpl"),
      path: "vitest.config.ts",
    },
    {
      content: buildLicense(config),
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

  if (config.includeJsr) {
    files.push({
      content: buildJsrJson(config),
      path: "jsr.json",
    });
  }

  if (config.githubRepoUrl.length > 0) {
    files.push(
      ...rootOwnedFiles(config, () => [
        {
          content: renderTemplate("renovate.json.tmpl"),
          path: "renovate.json",
        },
      ]),
    );
  }

  if (hasGitHubWorkflows(config)) {
    files.push(
      {
        content: buildCiWorkflow(config),
        path: ".github/workflows/ci.yml",
      },
      {
        content: buildReleaseWorkflow(config),
        path: ".github/workflows/release.yml",
      },
    );

    if (config.includeSecurityWorkflows) {
      files.push(
        {
          content: buildCodeqlWorkflow(),
          path: ".github/workflows/codeql.yml",
        },
        {
          content: buildScorecardWorkflow(),
          path: ".github/workflows/scorecard.yml",
        },
      );
    }
  }

  files.push(buildStateFile(config, files));

  return files;
};

const buildBundlerFiles = (config: ScaffoldConfig): GeneratedFile[] => {
  if (config.bundler === "tsdown") {
    const entries = ["./source/index.ts", ...(config.includeCli ? ["./source/cli.ts"] : [])];

    return [
      {
        content: renderTemplate("tsdown.config.ts.tmpl", {
          TSDOWN_ENTRIES: entries.map((entry) => `"${entry}"`).join(", "),
        }),
        path: "tsdown.config.ts",
      },
    ];
  }

  return [
    {
      content: renderTemplate("tsconfig.build.json.tmpl"),
      path: "tsconfig.build.json",
    },
  ];
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

const buildCliAgentGuidance = (includeCli: boolean): string =>
  includeCli
    ? "- Keep CLI entry points thin. Parse arguments and handle process I/O in CLI files, but put reusable behavior in normal library modules.\n"
    : "";
