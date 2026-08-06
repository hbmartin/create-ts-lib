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
import type { NodeTarget } from "./node-target.js";
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
import type { DetectedWorkspace } from "./workspace-detection.js";

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
  /** Parent workspace found near the target, when there is one. */
  detectedWorkspace?: DetectedWorkspace | undefined;
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
  const nodeTarget = await resolveNodeTarget(provided, promptModule, defaults);
  const githubRepositoryAnswer = await resolveGitHubRepository(
    provided,
    githubRepositoryLookup,
    promptModule,
    warn,
  );
  const featureAnswers = await promptForFeatures(provided, promptModule, defaults);
  const workspaceMode = await resolveWorkspaceMode(
    provided,
    promptModule,
    options.detectedWorkspace,
  );
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
      // Never prompted for: the scaffold year is stamped once, from the
      // resolved defaults, so `update` can replay it in later years.
      copyrightYear: defaults.copyrightYear,
      description,
      githubRepoUrl: githubRepositoryAnswer.url,
      ...featureAnswers,
      license,
      lintFormatTooling,
      nodeTarget,
      packageManager,
      projectName,
      workspaceMode,
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

const resolveNodeTarget = async (
  provided: ScaffoldConfigOverrides,
  promptModule: PromptModule,
  defaults: ScaffoldConfig,
): Promise<NodeTarget> =>
  provided.nodeTarget ??
  (await promptModule.select<NodeTarget>({
    choices: [
      { name: "Node 24 (LTS; CI on 24 and 26)", value: "24" },
      { name: "Node 26 (CI on 26 only)", value: "26" },
    ],
    default: defaults.nodeTarget,
    message: "Minimum Node version",
  }));

interface FeatureAnswers {
  includeCli: boolean;
  includeCodecov: boolean;
  includeCommunityFiles: boolean;
  includeJsr: boolean;
  includeSecurityWorkflows: boolean;
  includeZod: boolean;
}

/**
 * Only asked when a workspace was actually found nearby; with no workspace
 * around there is nothing to opt into, so the prompt stays out of the way.
 */
const resolveWorkspaceMode = async (
  provided: ScaffoldConfigOverrides,
  promptModule: PromptModule,
  detectedWorkspace: DetectedWorkspace | undefined,
): Promise<boolean> => {
  if (provided.workspaceMode !== undefined) {
    return provided.workspaceMode;
  }

  if (detectedWorkspace === undefined) {
    return false;
  }

  return promptModule.confirm({
    default: true,
    message: `Detected a workspace at ${detectedWorkspace.directory} (${detectedWorkspace.manifest}). Scaffold as a workspace package?`,
  });
};

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
  const includeCommunityFiles =
    provided.includeCommunityFiles ??
    (await promptModule.confirm({
      default: defaults.includeCommunityFiles,
      message: "Include CONTRIBUTING, CODE_OF_CONDUCT, and SECURITY files?",
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

  return {
    includeCli,
    includeCodecov,
    includeCommunityFiles,
    includeJsr,
    includeSecurityWorkflows,
    includeZod,
  };
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
      // Manual entry deliberately has no default: the detected git remote is
      // never verified against GitHub, so pre-filling it could silently carry
      // a stale URL forward.
      kind: "manual";
    };

interface GitHubRepoUrlAnswer {
  creation?: PendingGitHubRepositoryCreation;
  url: string;
}

const resolveGitHubRepository = async (
  provided: ScaffoldConfigOverrides,
  githubRepositoryLookup: Promise<GitHubRepositoryLookupResult> | undefined,
  promptModule: PromptModule,
  warn: WarningSink,
): Promise<GitHubRepoUrlAnswer> => {
  if (provided.githubRepoUrl !== undefined || githubRepositoryLookup === undefined) {
    return { url: provided.githubRepoUrl ?? "" };
  }

  const githubRepositoryPrompt = await promptForGitHubRepository(
    await githubRepositoryLookup,
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
    return { kind: "manual" };
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
    return { kind: "manual" };
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

  const url = await promptModule.input({
    ...(githubRepositoryPrompt.kind === "found"
      ? { default: githubRepositoryPrompt.defaultUrl }
      : {}),
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
