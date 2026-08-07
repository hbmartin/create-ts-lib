#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import process from "node:process";

import { cyan, red, yellow } from "yoctocolors";

import packageJson from "../package.json" with { type: "json" };
import { runConfigWorkflow } from "./cli-config.js";
import {
  type CliArguments,
  deriveDirectoryName,
  detectDefaults,
  parseCliArguments,
  type WarningSink,
} from "./cli-helpers.js";
import {
  createProgressReporter,
  printDryRunDetails,
  printNextSteps,
  printPostScaffoldRecovery,
  printSummary,
} from "./cli-output.js";
import {
  type PendingGitHubRepositoryCreation,
  promptForConfig,
  warnForNpmPackageNameAvailability,
} from "./cli-prompts.js";
import { runUpdateWorkflow } from "./cli-update.js";
import { formatGitHubRepositoryCreateWarning } from "./cli-warnings.js";
import { formatErrorMessage } from "./filesystem-errors.js";
import { createGitHubRepository } from "./github-cli.js";
import { assertValidPackageName } from "./package-name.js";
import { loadPromptModule } from "./prompts.js";
import { PostScaffoldSetupError, scaffoldProject } from "./scaffold.js";
import { assertTargetDirectoryIsSafe } from "./target-directory.js";
import { defaultScaffoldConfig, type ScaffoldConfig } from "./templates/files.js";
import { stripUndefinedOverrides } from "./templates/scaffold-config.js";
import {
  getUserConfigPath,
  loadUserConfig,
  saveUserConfig,
  type UserConfig,
} from "./user-config.js";
import { detectWorkspaceRoot } from "./workspace-detection.js";

const helpText = `create-ts-lib

Usage:
  create-ts-lib [directory] [options]
  create-ts-lib update [directory] [--dry-run] [--force] [--yes] [--no-backup]
                            [--remove-orphans]
  create-ts-lib config path
  create-ts-lib config get [key]
  create-ts-lib config set <key> <value>
  create-ts-lib config unset <key>

Options:
  --yes, -y                 Use detected/default answers without prompting
  --dry-run                 Print the scaffold plan without writing files
  --force                   Allow writing into a non-empty target directory
  --name <name>             Package name (defaults to the directory name)
  --description <text>      Package description
  --author <author>         Package author, e.g. "Ada <ada@example.com>"
  --license <license>       Choose Apache-2.0, MIT, ISC, or UNLICENSED
  --repo-url <url>          GitHub repository URL for generated metadata
  --package-manager <pm>    Choose pnpm, npm, or yarn
  --lint-format <tooling>   Choose oxlint-oxfmt or biome
  --bundler <bundler>       Choose tsc or tsdown
  --node-target <major>     Choose Node 24 or 26 as the generated engines floor
  --[no-]cli                Include or omit the CLI entry point
  --[no-]codecov            Include or omit Codecov upload in generated CI
  --[no-]community-files    Include or omit CONTRIBUTING, CODE_OF_CONDUCT, SECURITY
  --[no-]zod                Include or omit Zod in the generated project
  --[no-]jsr                Include or omit JSR publishing support
  --[no-]security-workflows Include or omit CodeQL and Scorecard workflows
  --[no-]workspace          Scaffold as a package inside an existing workspace
  --no-backup               Skip <file>.orig backups when update overwrites edits
  --remove-orphans          With --force, delete unmodified files the templates no longer generate
  --save-defaults           Save this run's reusable answers as personal defaults
  --config <path>           Read and write personal defaults at this path
  --skip-git                Skip git init and git remote setup
  --skip-install            Skip dependency install, build, and test
  --help, -h                Show help
  --version, -v             Show version

The update command re-renders generated tooling files in an existing project
and applies template improvements, skipping files you have modified.

The config command manages personal defaults, read by default from
$XDG_CONFIG_HOME/create-ts-lib/config.json (usually
~/.config/create-ts-lib/config.json).

Examples:
  pnpm create @hbmartin/ts-lib my-lib
  npm create @hbmartin/ts-lib my-lib
  npx @hbmartin/create-ts-lib my-lib
  npx @hbmartin/create-ts-lib my-lib --yes --license MIT --no-codecov
  npx @hbmartin/create-ts-lib my-lib --save-defaults
  npx @hbmartin/create-ts-lib update my-lib --dry-run
  npx @hbmartin/create-ts-lib config set license MIT
`;

const main = async (): Promise<void> => {
  const warn: WarningSink = (message) => {
    process.stderr.write(`${yellow("warning")} ${message}\n`);
  };

  let cliArguments: CliArguments;
  try {
    cliArguments = parseCliArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${red("error")} ${formatErrorMessage(error, "Invalid arguments")}\n\n`);
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
    await runCommand(cliArguments, warn);
  } catch (error) {
    handleCliError(error);
  }
};

const runCommand = async (cliArguments: CliArguments, warn: WarningSink): Promise<void> => {
  switch (cliArguments.command) {
    case "config":
      return runConfigWorkflow(cliArguments, warn);
    case "update":
      return runUpdateWorkflow(cliArguments, warn);
    case "scaffold":
      return runScaffoldWorkflow(cliArguments, warn);
  }
};

const buildProvidedOverrides = (cliArguments: CliArguments): Partial<ScaffoldConfig> =>
  stripUndefinedOverrides({
    author: cliArguments.author,
    bundler: cliArguments.bundler,
    description: cliArguments.description,
    githubRepoUrl: cliArguments.repoUrl,
    includeCli: cliArguments.cli,
    includeCodecov: cliArguments.codecov,
    includeCommunityFiles: cliArguments.communityFiles,
    includeJsr: cliArguments.jsr,
    includeSecurityWorkflows: cliArguments.securityWorkflows,
    includeZod: cliArguments.zod,
    license: cliArguments.license,
    lintFormatTooling: cliArguments.lintFormatTooling,
    nodeTarget: cliArguments.nodeTarget,
    packageManager: cliArguments.packageManager,
    projectName: cliArguments.projectName,
    workspaceMode: cliArguments.workspace,
  });

/**
 * Persists this run's reusable answers. Per-project values (name, description,
 * repo URL, workspace mode, copyright year) are deliberately excluded -- they
 * describe one project, not a preference.
 */
const saveDefaultsFromConfig = async (
  config: ScaffoldConfig,
  existingUserConfig: UserConfig,
  configPath: string,
): Promise<void> => {
  await saveUserConfig(
    {
      ...existingUserConfig,
      author: config.author,
      bundler: config.bundler,
      includeCli: config.includeCli,
      includeCodecov: config.includeCodecov,
      includeCommunityFiles: config.includeCommunityFiles,
      includeJsr: config.includeJsr,
      includeSecurityWorkflows: config.includeSecurityWorkflows,
      includeZod: config.includeZod,
      license: config.license,
      lintFormatTooling: config.lintFormatTooling,
      nodeTarget: config.nodeTarget,
      packageManager: config.packageManager,
    },
    configPath,
  );
  process.stdout.write(`${cyan("info")} Saved personal defaults to ${configPath}.\n\n`);
};

/**
 * Directory the new package will be created inside. Without a directory
 * argument the package always lands directly in the working directory.
 */
const getPackageContainingDirectory = (cliArguments: CliArguments): string =>
  cliArguments.directoryArgument === undefined
    ? process.cwd()
    : dirname(resolve(cliArguments.directoryArgument));

const runScaffoldWorkflow = async (
  cliArguments: CliArguments,
  warn: WarningSink,
): Promise<void> => {
  const userConfigPath = cliArguments.configPath ?? getUserConfigPath();
  const userConfig = await loadUserConfig(warn, userConfigPath);
  const defaults = await detectDefaults(cliArguments.directoryArgument, { warn });
  const promptDefaults = defaultScaffoldConfig({
    ...userConfig,
    author: userConfig.author ?? defaults.author,
    githubRepoUrl: defaults.githubRepoUrl,
    projectName: defaults.projectName,
  });
  const provided = buildProvidedOverrides(cliArguments);
  const detectedWorkspace =
    cliArguments.workspace === undefined
      ? await detectWorkspaceRoot(getPackageContainingDirectory(cliArguments))
      : undefined;
  const configResult = cliArguments.yes
    ? {
        config: defaultScaffoldConfig({
          ...promptDefaults,
          // Non-interactive runs cannot be asked, so a detected workspace opts
          // in automatically. The scaffold summary always reports the result.
          workspaceMode: detectedWorkspace !== undefined,
          ...provided,
        }),
      }
    : await promptForConfig({
        defaults: promptDefaults,
        detectedWorkspace,
        promptModule: await loadPromptModule(warn),
        provided,
        warn,
      });
  const { config, githubRepositoryCreation } = configResult;
  assertValidPackageName(config.projectName);
  if (cliArguments.yes) {
    await warnForNpmPackageNameAvailability(config.projectName, warn);
  }

  const targetDirectory = resolve(
    cliArguments.directoryArgument ?? deriveDirectoryName(config.projectName),
  );

  if (!cliArguments.dryRun) {
    await assertTargetDirectoryIsSafe(targetDirectory, cliArguments.force);
  }

  // After the safety check, so a scaffold that refuses to run does not leave
  // personal defaults behind, and never during a dry run: --dry-run promises no
  // writes, including the ones outside the target directory.
  if (cliArguments.saveDefaults) {
    if (cliArguments.dryRun) {
      process.stdout.write(
        `${cyan("info")} Dry run: personal defaults were not saved to ${userConfigPath}.\n\n`,
      );
    } else {
      await saveDefaultsFromConfig(config, userConfig, userConfigPath);
    }
  }

  printSummary(config, targetDirectory, cliArguments.dryRun, githubRepositoryCreation);

  if (cliArguments.dryRun) {
    printDryRunDetails(config, githubRepositoryCreation);
    return;
  }

  const gitRemoteOriginUrl = getGitRemoteOriginUrl(cliArguments, config);
  await createGitHubRepositoryIfNeeded(config, githubRepositoryCreation, warn);
  await scaffoldProject(config, {
    force: cliArguments.force,
    ...(gitRemoteOriginUrl === undefined ? {} : { gitRemoteOriginUrl }),
    progress: createProgressReporter(),
    skipGit: cliArguments.skipGit,
    skipInstall: cliArguments.skipInstall,
    targetDirectory,
  });
  printNextSteps(config, targetDirectory, {
    includeGitHubPublishSteps: gitRemoteOriginUrl !== undefined,
    skipGit: cliArguments.skipGit,
    skipInstall: cliArguments.skipInstall,
  });
};

const handleCliError = (error: unknown): void => {
  if (error instanceof PostScaffoldSetupError) {
    process.stderr.write(`${red("error")} ${error.message}\n\n`);
    printPostScaffoldRecovery(error);
    process.exitCode = 1;
    return;
  }

  process.stderr.write(`${red("error")} ${formatErrorMessage(error, "Scaffolding failed")}\n`);
  process.exitCode = 1;
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
    visibility: githubRepositoryCreation.visibility,
  });

  if (createResult.status === "failed") {
    warn(formatGitHubRepositoryCreateWarning(createResult));
  }
};

const getGitRemoteOriginUrl = (
  cliArguments: CliArguments,
  config: ScaffoldConfig,
): string | undefined => {
  // --skip-git skips all git setup, so no remote applies anywhere downstream.
  if (cliArguments.skipGit) {
    return undefined;
  }

  if (config.githubRepoUrl.length === 0) {
    return undefined;
  }

  // --yes historically skips remote setup unless the repo URL was passed explicitly.
  if (cliArguments.yes && cliArguments.repoUrl === undefined) {
    return undefined;
  }

  return config.githubRepoUrl;
};

await main();
