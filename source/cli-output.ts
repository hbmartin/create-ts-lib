import process from "node:process";

import ora, { type Ora } from "ora";
import { cyan, green, red, yellow } from "yoctocolors";

import type { PendingGitHubRepositoryCreation } from "./cli-prompts.js";
import { formatLintFormatTooling } from "./lint-format-tooling.js";
import { parseGitHubRepositoryUrl } from "./name-helpers.js";
import type { PostScaffoldSetupError, ScaffoldProgress } from "./scaffold.js";
import { featureInactiveReason } from "./templates/feature-activation.js";
import { buildProjectFiles, type PackageManager, type ScaffoldConfig } from "./templates/files.js";
import { hasGitHubWorkflows } from "./templates/readme.js";

export interface NextStepsOptions {
  includeGitHubPublishSteps: boolean;
  skipGit: boolean;
  skipInstall: boolean;
}

/**
 * Renders an answer the current config makes inert, without discarding it.
 *
 * Only a `yes` is qualified: that is the only case where a bare value would
 * claim something the scaffold did not do. The answer stays visible rather than
 * being blanked, because it is recorded in the state file and applies again as
 * soon as whatever suppresses it changes.
 */
const formatFeatureAnswer = (
  config: ScaffoldConfig,
  resolveInactiveReason: (config: ScaffoldConfig) => string | undefined,
  answer: boolean,
): string => {
  if (!answer) {
    return "no";
  }

  const inactiveReason = resolveInactiveReason(config);

  return inactiveReason === undefined ? "yes" : `yes (${inactiveReason})`;
};

export const printSummary = (
  config: ScaffoldConfig,
  targetDirectory: string,
  dryRun: boolean,
  githubRepositoryCreation: PendingGitHubRepositoryCreation | undefined,
): void => {
  const rows = [
    ["Project", config.projectName],
    ["Target", targetDirectory],
    ["Description", config.description || "(empty)"],
    ["Author", config.author || "(empty)"],
    ["License", config.license],
    ["Lint/format", formatLintFormatTooling(config.lintFormatTooling)],
    ["Build tool", config.bundler],
    ["Node target", `${config.nodeTarget}+`],
    ["Package manager", config.packageManager],
    ["GitHub repo", config.githubRepoUrl || "(none)"],
    [
      "Codecov",
      formatFeatureAnswer(config, featureInactiveReason.includeCodecov, config.includeCodecov),
    ],
    [
      "Security workflows",
      formatFeatureAnswer(
        config,
        featureInactiveReason.includeSecurityWorkflows,
        config.includeSecurityWorkflows,
      ),
    ],
    [
      "Community files",
      formatFeatureAnswer(
        config,
        featureInactiveReason.includeCommunityFiles,
        config.includeCommunityFiles,
      ),
    ],
    ["Workspace package", config.workspaceMode ? "yes" : "no"],
    ["CLI entry", config.includeCli ? "yes" : "no"],
    ["Zod", config.includeZod ? "yes" : "no"],
    ["JSR", config.includeJsr ? "yes" : "no"],
  ];

  process.stdout.write(`${dryRun ? cyan("Dry run") : cyan("Scaffold summary")}\n`);
  for (const [label, value] of rows) {
    process.stdout.write(`  ${label}: ${value}\n`);
  }
  if (!dryRun && githubRepositoryCreation) {
    process.stdout.write(
      `  GitHub repo action: will create ${githubRepositoryCreation.visibility} repo ${githubRepositoryCreation.owner}/${githubRepositoryCreation.repositoryName}\n`,
    );
  }
  process.stdout.write("\n");
};

export const printDryRunDetails = (
  config: ScaffoldConfig,
  githubRepositoryCreation: PendingGitHubRepositoryCreation | undefined,
): void => {
  if (githubRepositoryCreation) {
    printDryRunGitHubCreation(githubRepositoryCreation);
  }

  printDryRunFiles(config);
};

const printDryRunGitHubCreation = (creation: PendingGitHubRepositoryCreation): void => {
  process.stdout.write(
    `${cyan("info")} GitHub repo creation skipped by --dry-run; would create ${creation.visibility} repo ${creation.owner}/${creation.repositoryName}.\n`,
  );
};

const printDryRunFiles = (config: ScaffoldConfig): void => {
  process.stdout.write("Files to create:\n");
  for (const file of buildProjectFiles(config)) {
    process.stdout.write(`  ${file.path}\n`);
  }
};

export const printNextSteps = (
  config: ScaffoldConfig,
  targetDirectory: string,
  options: NextStepsOptions,
): void => {
  const runPrefix = getPackageManagerRunPrefix(config.packageManager);
  const skippedSetupSteps = [
    ...(options.skipGit ? ["  git init"] : []),
    ...(options.skipInstall ? [`  ${config.packageManager} install`] : []),
  ]
    .map((step) => `${step}\n`)
    .join("");
  // Workspace mode skips git setup entirely, so no remote was added here even
  // when one is configured -- printing `git push -u origin HEAD` would name a
  // remote that does not exist. The repository URL still belongs in the
  // generated package.json: it is the parent repository's.
  const githubPublishSteps =
    options.includeGitHubPublishSteps && !config.workspaceMode
      ? `
Publish to GitHub:
  git add .
  git commit -m "Initial scaffold"
  git push -u origin HEAD
`
      : "";
  const trustedPublishingStep = hasGitHubWorkflows(config)
    ? `
Enable npm trusted publishing for the release workflow: https://docs.npmjs.com/trusted-publishers
`
    : "";
  const codecovSetupStep = buildCodecovSetupStep(config);
  const workspaceSteps = buildWorkspaceSteps(config);

  process.stdout.write(`Created ${config.projectName}

Next steps:
  cd ${formatShellArgument(targetDirectory)}
${skippedSetupSteps}  ${runPrefix} dev
  ${runPrefix} lint
  ${runPrefix} test
${workspaceSteps}${githubPublishSteps}${trustedPublishingStep}${codecovSetupStep}`);
};

// Workspace mode never writes outside the target directory, so registering the
// package in the parent manifest is left to the user as an explicit step.
const buildWorkspaceSteps = (config: ScaffoldConfig): string => {
  if (!config.workspaceMode) {
    return "";
  }

  return `
Workspace package: root-owned files (git ignore, CI workflows, Renovate, editor
settings, hooks, community health files) were not generated. Confirm the
workspace globs match this package, then install from the workspace root:
  ${config.packageManager} install
`;
};

const buildCodecovSetupStep = (config: ScaffoldConfig): string => {
  // Gated on the same declaration the summary uses, rather than a second
  // hand-written copy of the conditions. The upload step lives in the generated
  // CI workflow, so wherever that is not emitted there is nothing for Codecov to
  // receive and the URL would name a repository this scaffold does not own.
  if (!config.includeCodecov || featureInactiveReason.includeCodecov(config) !== undefined) {
    return "";
  }

  const repository = parseGitHubRepositoryUrl(config.githubRepoUrl);
  if (repository === undefined) {
    return "";
  }

  return `
Set up Codecov: https://app.codecov.io/gh/${repository.owner}/${repository.repo}/new
`;
};

export const printPostScaffoldRecovery = (error: PostScaffoldSetupError): void => {
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

export const getPackageManagerRunPrefix = (packageManager: PackageManager): string =>
  packageManager === "pnpm" ? "pnpm run" : `${packageManager} run`;

const safeShellArgumentRegex = /^[\w./:@%+=,-]+$/;

export const formatShellArgument = (
  value: string,
  platform: NodeJS.Platform = process.platform,
): string => {
  if (safeShellArgumentRegex.test(value)) {
    return value;
  }

  // cmd.exe treats single quotes as literal characters; double quotes work in
  // both cmd.exe and PowerShell, and `"` cannot appear in Windows paths.
  return platform === "win32" ? `"${value}"` : `'${value.replaceAll("'", "'\\''")}'`;
};

export const createProgressReporter = (): ScaffoldProgress => {
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
