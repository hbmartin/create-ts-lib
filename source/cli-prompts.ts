import type { WarningSink } from "./cli-helpers.js";
import {
  formatGitHubRepositoryLookupWarning,
  formatNpmAvailabilityUnknownWarning,
  formatNpmPackageNameExistsWarning,
} from "./cli-warnings.js";
import {
  type GitHubRepositoryLookupResult,
  type GitHubRepositoryVisibility,
  inspectPersonalGitHubRepository,
} from "./github-cli.js";
import type { LintFormatTooling } from "./lint-format-tooling.js";
import { checkNpmPackageNameAvailability } from "./npm-registry.js";
import { validatePackageName } from "./package-name.js";
import type { PromptModule } from "./prompts.js";
import type {
  Bundler,
  LicenseName,
  PackageManager,
  ScaffoldConfig,
  ScaffoldConfigOverrides,
} from "./templates/scaffold-config.js";

export interface PendingGitHubRepositoryCreation {
  owner: string;
  repositoryName: string;
  url: string;
  visibility: GitHubRepositoryVisibility;
}

export interface PromptedConfig {
  config: ScaffoldConfig;
  githubRepositoryCreation?: PendingGitHubRepositoryCreation;
}

export interface PromptForConfigOptions {
  /** Fully resolved prompt defaults (built-ins + user config + detection). */
  defaults: ScaffoldConfig;
  promptModule: PromptModule;
  /** CLI-provided values; a provided value skips its prompt entirely. */
  provided: ScaffoldConfigOverrides;
  warn: WarningSink;
}

export const promptForConfig = async (options: PromptForConfigOptions): Promise<PromptedConfig> => {
  const { defaults, promptModule, provided, warn } = options;

  const projectName = await resolveProjectName(options);
  const githubRepositoryLookup =
    provided.githubRepoUrl === undefined ? inspectPersonalGitHubRepository(projectName) : undefined;

  const description =
    provided.description ??
    (await promptModule.input({
      default: defaults.description,
      message: "Description",
    }));
  const author =
    provided.author ??
    (await promptModule.input({
      default: defaults.author,
      message: "Author",
    }));
  const license = await resolveLicense(provided, promptModule, defaults);
  const lintFormatTooling = await resolveLintFormatTooling(provided, promptModule, defaults);
  const bundler = await resolveBundler(provided, promptModule, defaults);
  const githubRepositoryAnswer = await resolveGitHubRepository(
    provided,
    githubRepositoryLookup,
    defaults,
    promptModule,
    warn,
  );
  const featureAnswers = await promptForFeatures(provided, promptModule, defaults);
  const packageManager =
    provided.packageManager ??
    (await promptModule.select<PackageManager>({
      choices: [
        { name: "pnpm", value: "pnpm" },
        { name: "npm", value: "npm" },
        { name: "yarn", value: "yarn" },
      ],
      default: defaults.packageManager,
      message: "Package manager",
    }));

  return {
    config: {
      author,
      bundler,
      description,
      githubRepoUrl: githubRepositoryAnswer.url,
      ...featureAnswers,
      license,
      lintFormatTooling,
      packageManager,
      projectName,
    },
    ...(githubRepositoryAnswer.creation
      ? { githubRepositoryCreation: githubRepositoryAnswer.creation }
      : {}),
  };
};

const resolveProjectName = async (options: PromptForConfigOptions): Promise<string> => {
  if (options.provided.projectName !== undefined) {
    await warnForNpmPackageNameAvailability(options.provided.projectName, options.warn);
    return options.provided.projectName;
  }

  return promptForProjectName(options.defaults.projectName, options.promptModule, options.warn);
};

const resolveLicense = async (
  provided: ScaffoldConfigOverrides,
  promptModule: PromptModule,
  defaults: ScaffoldConfig,
): Promise<LicenseName> =>
  provided.license ??
  (await promptModule.select<LicenseName>({
    choices: [
      { name: "Apache-2.0", value: "Apache-2.0" },
      { name: "MIT", value: "MIT" },
      { name: "ISC", value: "ISC" },
      { name: "UNLICENSED", value: "UNLICENSED" },
    ],
    default: defaults.license,
    message: "License",
  }));

const resolveLintFormatTooling = async (
  provided: ScaffoldConfigOverrides,
  promptModule: PromptModule,
  defaults: ScaffoldConfig,
): Promise<LintFormatTooling> =>
  provided.lintFormatTooling ??
  (await promptModule.select<LintFormatTooling>({
    choices: [
      { name: "Oxlint + Oxfmt", value: "oxlint-oxfmt" },
      { name: "Biome", value: "biome" },
    ],
    default: defaults.lintFormatTooling,
    message: "Lint and format tooling",
  }));

const resolveBundler = async (
  provided: ScaffoldConfigOverrides,
  promptModule: PromptModule,
  defaults: ScaffoldConfig,
): Promise<Bundler> =>
  provided.bundler ??
  (await promptModule.select<Bundler>({
    choices: [
      { name: "tsc (plain TypeScript compiler)", value: "tsc" },
      { name: "tsdown (bundler)", value: "tsdown" },
    ],
    default: defaults.bundler,
    message: "Build tool",
  }));

interface FeatureAnswers {
  includeCli: boolean;
  includeCodecov: boolean;
  includeJsr: boolean;
  includeSecurityWorkflows: boolean;
  includeZod: boolean;
}

const promptForFeatures = async (
  provided: ScaffoldConfigOverrides,
  promptModule: PromptModule,
  defaults: ScaffoldConfig,
): Promise<FeatureAnswers> => {
  const includeCodecov =
    provided.includeCodecov ??
    (await promptModule.confirm({
      default: defaults.includeCodecov,
      message: "Include Codecov?",
    }));
  const includeSecurityWorkflows =
    provided.includeSecurityWorkflows ??
    (await promptModule.confirm({
      default: defaults.includeSecurityWorkflows,
      message: "Include CodeQL and Scorecard workflows?",
    }));
  const includeCli =
    provided.includeCli ??
    (await promptModule.confirm({
      default: defaults.includeCli,
      message: "Include CLI entry point?",
    }));
  const includeZod =
    provided.includeZod ??
    (await promptModule.confirm({
      default: defaults.includeZod,
      message: "Include Zod?",
    }));
  const includeJsr =
    provided.includeJsr ??
    (await promptModule.confirm({
      default: defaults.includeJsr,
      message: "Also publish to JSR?",
    }));

  return { includeCli, includeCodecov, includeJsr, includeSecurityWorkflows, includeZod };
};

type ExistingPackageNameDecision = "rename" | "use-anyway";
type MissingGitHubRepositoryDecision = "create-private" | "create-public" | "manual";

type GitHubRepositoryPrompt =
  | {
      defaultUrl: string;
      kind: "found";
    }
  | {
      creation: PendingGitHubRepositoryCreation;
      kind: "create";
    }
  | {
      defaultUrl?: string;
      kind: "manual";
    };

interface GitHubRepoUrlAnswer {
  creation?: PendingGitHubRepositoryCreation;
  url: string;
}

const resolveGitHubRepository = async (
  provided: ScaffoldConfigOverrides,
  githubRepositoryLookup: Promise<GitHubRepositoryLookupResult> | undefined,
  defaults: ScaffoldConfig,
  promptModule: PromptModule,
  warn: WarningSink,
): Promise<GitHubRepoUrlAnswer> => {
  if (provided.githubRepoUrl !== undefined || githubRepositoryLookup === undefined) {
    return { url: provided.githubRepoUrl ?? "" };
  }

  const githubRepositoryPrompt = await promptForGitHubRepository(
    await githubRepositoryLookup,
    defaults.githubRepoUrl,
    promptModule,
    warn,
  );

  return promptForGitHubRepoUrl(githubRepositoryPrompt, promptModule);
};

const promptForProjectName = async (
  defaultProjectNameFromCaller: string,
  promptModule: PromptModule,
  warn: WarningSink,
): Promise<string> => {
  let defaultProjectName: string | undefined = defaultProjectNameFromCaller;

  for (;;) {
    const projectName = await promptModule.input({
      ...(defaultProjectName === undefined ? {} : { default: defaultProjectName }),
      message: "Project name",
      validate: validateProjectNameForPrompt,
    });
    const availability = await checkNpmPackageNameAvailability(projectName);

    if (availability.status === "available") {
      return projectName;
    }

    if (availability.status === "unknown") {
      warn(formatNpmAvailabilityUnknownWarning(availability));
      return projectName;
    }

    warn(formatNpmPackageNameExistsWarning(projectName));
    const decision = await promptModule.select<ExistingPackageNameDecision>({
      choices: [
        { name: "Rename", value: "rename" },
        { name: "Use anyway", value: "use-anyway" },
      ],
      default: "rename",
      message: "Package name already exists on npm",
    });

    if (decision === "use-anyway") {
      return projectName;
    }

    defaultProjectName = undefined;
  }
};

const validateProjectNameForPrompt = (projectName: string): true | string => {
  const validation = validatePackageName(projectName);

  return validation.valid ? true : validation.errors.join(" ");
};

const promptForGitHubRepository = async (
  lookup: GitHubRepositoryLookupResult,
  defaultGitHubRepoUrl: string,
  promptModule: PromptModule,
  warn: WarningSink,
): Promise<GitHubRepositoryPrompt> => {
  if (lookup.status === "found") {
    return {
      defaultUrl: lookup.url,
      kind: "found",
    };
  }

  if (lookup.status === "unavailable") {
    warn(formatGitHubRepositoryLookupWarning(lookup));
    return buildManualGitHubRepositoryPrompt("");
  }

  const decision = await promptModule.select<MissingGitHubRepositoryDecision>({
    choices: [
      {
        name: `Create public GitHub repo ${lookup.owner}/${lookup.repositoryName}`,
        value: "create-public",
      },
      {
        name: `Create private GitHub repo ${lookup.owner}/${lookup.repositoryName}`,
        value: "create-private",
      },
      { name: "Enter GitHub repo URL manually", value: "manual" },
    ],
    default: "create-public",
    message: "No matching GitHub repo was found",
  });

  if (decision === "manual") {
    return buildManualGitHubRepositoryPrompt(defaultGitHubRepoUrl);
  }

  return {
    creation: {
      owner: lookup.owner,
      repositoryName: lookup.repositoryName,
      url: lookup.predictedUrl,
      visibility: decision === "create-private" ? "private" : "public",
    },
    kind: "create",
  };
};

const buildManualGitHubRepositoryPrompt = (defaultUrl: string): GitHubRepositoryPrompt => ({
  ...(defaultUrl.length > 0 ? { defaultUrl } : {}),
  kind: "manual",
});

const promptForGitHubRepoUrl = async (
  githubRepositoryPrompt: GitHubRepositoryPrompt,
  promptModule: PromptModule,
): Promise<GitHubRepoUrlAnswer> => {
  if (githubRepositoryPrompt.kind === "create") {
    return {
      creation: githubRepositoryPrompt.creation,
      url: githubRepositoryPrompt.creation.url,
    };
  }

  const { defaultUrl } = githubRepositoryPrompt;
  const url = await promptModule.input({
    ...(defaultUrl === undefined ? {} : { default: defaultUrl }),
    message: "GitHub repo URL",
  });

  return { url };
};

export const warnForNpmPackageNameAvailability = async (
  packageName: string,
  warn: WarningSink,
): Promise<void> => {
  const availability = await checkNpmPackageNameAvailability(packageName);

  if (availability.status === "exists") {
    warn(formatNpmPackageNameExistsWarning(packageName));
    return;
  }

  if (availability.status === "unknown") {
    warn(formatNpmAvailabilityUnknownWarning(availability));
  }
};
