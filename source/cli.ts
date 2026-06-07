#!/usr/bin/env node
import { basename, resolve } from "node:path";

import ora, { type Ora } from "ora";
import { cyan, green, red, yellow } from "yoctocolors";

import packageJson from "../package.json" with { type: "json" };

import {
  type CliArguments,
  type DetectedDefaults,
  deriveDirectoryName,
  detectDefaults,
  parseCliArguments,
  type WarningSink,
} from "./cli-helpers.js";
import {
  createGitHubRepository,
  type GitHubRepositoryLookupResult,
  inspectPersonalGitHubRepository,
} from "./github-cli.js";
import {
  checkNpmPackageNameAvailability,
  type NpmPackageNameAvailabilityUnknown,
} from "./npm-registry.js";
import { assertValidPackageName, validatePackageName } from "./package-name.js";
import { loadPromptModule, type PromptModule } from "./prompts.js";
import {
  PostScaffoldSetupError,
  type ScaffoldOptions,
  type ScaffoldProgress,
  scaffoldProject,
} from "./scaffold.js";
import {
  buildProjectFiles,
  type LicenseName,
  type PackageManager,
  type ScaffoldConfig,
} from "./templates/files.js";

const helpText = `create-ts-lib

Usage:
  create-ts-lib [directory] [--yes] [--dry-run] [--force]

Options:
  --yes, -y    Use detected/default answers without prompting
  --dry-run    Print the scaffold plan without writing files
  --force      Allow writing into a non-empty target directory
  --help, -h   Show help
  --version, -v Show version

Examples:
  pnpm create @hbmartin/ts-lib my-lib
  npm create @hbmartin/ts-lib my-lib
  npx @hbmartin/create-ts-lib my-lib
`;

const main = async (): Promise<void> => {
  const warn: WarningSink = (message) => {
    process.stderr.write(`${yellow("warning")} ${message}\n`);
  };

  let cliArguments: CliArguments;
  try {
    cliArguments = parseCliArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${red("error")} ${error instanceof Error ? error.message : "Invalid arguments"}\n\n`,
    );
    process.stderr.write(helpText);
    process.exitCode = 1;
    return;
  }

  if (cliArguments.help) {
    process.stdout.write(helpText);
    return;
  }

  if (cliArguments.version) {
    process.stdout.write(`${packageJson.version}\n`);
    return;
  }

  try {
    await runScaffoldWorkflow(cliArguments, warn);
  } catch (error) {
    handleCliError(error);
  }
};

const runScaffoldWorkflow = async (
  cliArguments: CliArguments,
  warn: WarningSink,
): Promise<void> => {
  const defaults = await detectDefaults(cliArguments.directoryArgument, { warn });
  const configResult = cliArguments.yes
    ? { config: buildDefaultConfig(defaults) }
    : await promptForConfig(defaults, await loadPromptModule(warn), warn);
  const { config, githubRepositoryCreation } = configResult;
  assertValidPackageName(config.projectName);
  if (cliArguments.yes) {
    await warnForNpmPackageNameAvailability(config.projectName, warn);
  }

  const targetDirectory = resolve(
    cliArguments.directoryArgument ?? deriveDirectoryName(config.projectName),
  );

  printSummary(config, targetDirectory, cliArguments.dryRun);

  if (cliArguments.dryRun) {
    printDryRunDetails(config, githubRepositoryCreation);
    return;
  }

  await createGitHubRepositoryIfNeeded(config, githubRepositoryCreation, warn);
  await scaffoldProject(config, {
    force: cliArguments.force,
    ...buildGitRemoteOriginOption(cliArguments, config),
    progress: createProgressReporter(),
    targetDirectory,
  });
  printNextSteps(config, targetDirectory);
};

const handleCliError = (error: unknown): void => {
  if (error instanceof PostScaffoldSetupError) {
    process.stderr.write(`${red("error")} ${error.message}\n\n`);
    printPostScaffoldRecovery(error);
    process.exitCode = 1;
    return;
  }

  process.stderr.write(
    `${red("error")} ${error instanceof Error ? error.message : "Scaffolding failed"}\n`,
  );
  process.exitCode = 1;
};

const printDryRunDetails = (
  config: ScaffoldConfig,
  githubRepositoryCreation: PendingGitHubRepositoryCreation | undefined,
): void => {
  if (githubRepositoryCreation) {
    printDryRunGitHubCreation(githubRepositoryCreation);
  }

  printDryRunFiles(config);
};

const createGitHubRepositoryIfNeeded = async (
  config: ScaffoldConfig,
  githubRepositoryCreation: PendingGitHubRepositoryCreation | undefined,
  warn: WarningSink,
): Promise<void> => {
  if (!githubRepositoryCreation) {
    return;
  }

  const createResult = await createGitHubRepository({
    description: config.description,
    owner: githubRepositoryCreation.owner,
    repositoryName: githubRepositoryCreation.repositoryName,
  });

  if (createResult.status === "failed") {
    warn(formatGitHubRepositoryCreateWarning(createResult));
  }
};

type GitRemoteOriginOption = Pick<ScaffoldOptions, "gitRemoteOriginUrl"> | Record<string, never>;

const buildGitRemoteOriginOption = (
  cliArguments: CliArguments,
  config: ScaffoldConfig,
): GitRemoteOriginOption => {
  if (cliArguments.yes || config.githubRepoUrl.length === 0) {
    return {};
  }

  return { gitRemoteOriginUrl: config.githubRepoUrl };
};

const printNextSteps = (config: ScaffoldConfig, targetDirectory: string): void => {
  const runPrefix = getPackageManagerRunPrefix(config.packageManager);
  process.stdout.write(`Created ${config.projectName}

Next steps:
  cd ${basename(targetDirectory)}
  ${runPrefix} dev
  ${runPrefix} lint
  ${runPrefix} test
`);
};

const printPostScaffoldRecovery = (error: PostScaffoldSetupError): void => {
  process.stderr.write(
    `${yellow("recovery")} Project files were created at ${error.targetDirectory}, but setup did not finish.\n`,
  );
  process.stderr.write("Run these commands to retry the failed setup steps:\n");
  process.stderr.write(`  cd ${formatShellArgument(error.targetDirectory)}\n`);

  for (const command of buildPostScaffoldRecoveryCommands(error)) {
    process.stderr.write(`  ${command}\n`);
  }
};

const buildPostScaffoldRecoveryCommands = (error: PostScaffoldSetupError): string[] => {
  const runPrefix = getPackageManagerRunPrefix(error.packageManager);
  const installCommand = `${error.packageManager} install`;
  const buildCommand = `${runPrefix} build`;
  const testCommand = `${runPrefix} test`;

  switch (error.step) {
    case "git":
      return ["git init", installCommand, buildCommand, testCommand];
    case "install":
      return [installCommand, buildCommand, testCommand];
    case "build":
      return [buildCommand, testCommand];
    case "test":
      return [testCommand];
  }
};

const getPackageManagerRunPrefix = (packageManager: PackageManager): string =>
  packageManager === "pnpm" ? "pnpm run" : `${packageManager} run`;

const safeShellArgumentRegex = /^[\w./:@%+=,-]+$/;

const formatShellArgument = (value: string): string =>
  safeShellArgumentRegex.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;

const buildDefaultConfig = (defaults: DetectedDefaults): ScaffoldConfig => ({
  author: defaults.author,
  description: "",
  githubRepoUrl: defaults.githubRepoUrl,
  includeCli: false,
  includeCodecov: true,
  license: "Apache-2.0",
  packageManager: "pnpm",
  projectName: defaults.projectName,
});

interface PromptedConfig {
  config: ScaffoldConfig;
  githubRepositoryCreation?: PendingGitHubRepositoryCreation;
}

interface PendingGitHubRepositoryCreation {
  owner: string;
  repositoryName: string;
  url: string;
}

const promptForConfig = async (
  defaults: DetectedDefaults,
  promptModule: PromptModule,
  warn: WarningSink,
): Promise<PromptedConfig> => {
  const projectName = await promptForProjectName(defaults, promptModule, warn);
  const githubRepositoryPrompt = await promptForGitHubRepository(projectName, promptModule, warn);
  const description = await promptModule.input({
    default: "",
    message: "Description",
  });
  const author = await promptModule.input({
    default: defaults.author,
    message: "Author",
  });
  const license = await promptModule.select<LicenseName>({
    choices: [
      { name: "Apache-2.0", value: "Apache-2.0" },
      { name: "MIT", value: "MIT" },
      { name: "ISC", value: "ISC" },
      { name: "UNLICENSED", value: "UNLICENSED" },
    ],
    default: "Apache-2.0",
    message: "License",
  });
  const githubRepositoryAnswer = await promptForGitHubRepoUrl(githubRepositoryPrompt, promptModule);
  const includeCodecov = await promptModule.confirm({
    default: true,
    message: "Include Codecov?",
  });
  const includeCli = await promptModule.confirm({
    default: false,
    message: "Include CLI entry point?",
  });
  const packageManager = await promptModule.select<PackageManager>({
    choices: [
      { name: "pnpm", value: "pnpm" },
      { name: "npm", value: "npm" },
      { name: "yarn", value: "yarn" },
    ],
    default: "pnpm",
    message: "Package manager",
  });

  return {
    config: {
      author,
      description,
      githubRepoUrl: githubRepositoryAnswer.url,
      includeCli,
      includeCodecov,
      license,
      packageManager,
      projectName,
    },
    ...(githubRepositoryAnswer.creation
      ? { githubRepositoryCreation: githubRepositoryAnswer.creation }
      : {}),
  };
};

type ExistingPackageNameDecision = "rename" | "use-anyway";
type MissingGitHubRepositoryDecision = "create" | "manual";

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
      kind: "manual";
    };

interface GitHubRepoUrlAnswer {
  creation?: PendingGitHubRepositoryCreation;
  url: string;
}

const promptForProjectName = async (
  defaults: DetectedDefaults,
  promptModule: PromptModule,
  warn: WarningSink,
): Promise<string> => {
  let defaultProjectName: string | undefined = defaults.projectName;

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
  projectName: string,
  promptModule: PromptModule,
  warn: WarningSink,
): Promise<GitHubRepositoryPrompt> => {
  const lookup = await inspectPersonalGitHubRepository(projectName);

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
        value: "create",
      },
      { name: "Enter GitHub repo URL manually", value: "manual" },
    ],
    default: "create",
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

const warnForNpmPackageNameAvailability = async (
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

const formatNpmPackageNameExistsWarning = (packageName: string): string =>
  `Package name "${packageName}" already exists on npm.`;

const formatNpmAvailabilityUnknownWarning = (
  availability: NpmPackageNameAvailabilityUnknown,
): string => {
  const detail =
    availability.statusCode === undefined
      ? availability.error
      : `npm registry returned HTTP ${availability.statusCode}`;

  return `Could not check npm availability for "${availability.packageName}"; continuing. ${detail}.`;
};

const formatGitHubRepositoryLookupWarning = (
  lookup: Extract<GitHubRepositoryLookupResult, { status: "unavailable" }>,
): string =>
  `Could not inspect GitHub repositories with gh; continuing with manual URL entry. ${lookup.reason}.`;

const formatGitHubRepositoryCreateWarning = (
  createResult: Extract<Awaited<ReturnType<typeof createGitHubRepository>>, { status: "failed" }>,
): string =>
  `Could not create GitHub repo "${createResult.owner}/${createResult.repositoryName}" with gh; continuing with ${createResult.url}. ${createResult.reason}.`;

const printSummary = (config: ScaffoldConfig, targetDirectory: string, dryRun: boolean): void => {
  const rows = [
    ["Project", config.projectName],
    ["Target", targetDirectory],
    ["Description", config.description || "(empty)"],
    ["Author", config.author || "(empty)"],
    ["License", config.license],
    ["Package manager", config.packageManager],
    ["GitHub repo", config.githubRepoUrl || "(none)"],
    ["Codecov", config.includeCodecov ? "yes" : "no"],
    ["CLI entry", config.includeCli ? "yes" : "no"],
  ];

  process.stdout.write(`${dryRun ? cyan("Dry run") : cyan("Scaffold summary")}\n`);
  for (const [label, value] of rows) {
    process.stdout.write(`  ${label}: ${value}\n`);
  }
  process.stdout.write("\n");
};

const printDryRunGitHubCreation = (creation: PendingGitHubRepositoryCreation): void => {
  process.stdout.write(
    `${cyan("info")} GitHub repo creation skipped by --dry-run; would create ${creation.owner}/${creation.repositoryName}.\n`,
  );
};

const printDryRunFiles = (config: ScaffoldConfig): void => {
  process.stdout.write("Files to create:\n");
  for (const file of buildProjectFiles(config)) {
    process.stdout.write(`  ${file.path}\n`);
  }
};

const createProgressReporter = (): ScaffoldProgress => {
  const { CI: continuousIntegration } = process.env;
  const useSpinner = Boolean(process.stdout.isTTY) && continuousIntegration !== "true";
  let spinner: Ora | undefined;

  return {
    fail: (message) => {
      if (spinner) {
        spinner.fail(message);
        spinner = undefined;
        return;
      }

      process.stdout.write(`${red("failed")} ${message}\n`);
    },
    info: (message) => {
      process.stdout.write(`${cyan("info")} ${message}\n`);
    },
    start: (message) => {
      if (useSpinner) {
        spinner = ora(message).start();
        return;
      }

      process.stdout.write(`${cyan("start")} ${message}\n`);
    },
    succeed: (message) => {
      if (spinner) {
        spinner.succeed(message);
        spinner = undefined;
        return;
      }

      process.stdout.write(`${green("done")} ${message}\n`);
    },
  };
};

await main();
