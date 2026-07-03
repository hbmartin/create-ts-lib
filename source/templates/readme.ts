import { normalizeGitHubUrl, parseGitHubRepositoryUrl } from "../name-helpers.js";
import { semgrepVersion } from "./generated-versions.js";
import {
  extractAuthorName,
  getBinName,
  type LicenseName,
  packageManagerConfig,
  type ScaffoldConfig,
} from "./scaffold-config.js";

export const hasGitHubWorkflows = (config: ScaffoldConfig): boolean =>
  config.githubRepoUrl.length > 0 && config.packageManager === "pnpm";

export const buildReadme = (config: ScaffoldConfig): string => {
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
${buildReleaseSection(config)}
## License

[${config.license}](LICENSE) © ${authorName}.
`;
};

const buildReleaseSection = (config: ScaffoldConfig): string => {
  if (!hasGitHubWorkflows(config)) {
    return "";
  }

  const repository = parseGitHubRepositoryUrl(config.githubRepoUrl);
  const trustedPublisherHint = repository ? ` for \`${repository.owner}/${repository.repo}\`` : "";
  const jsrSection = config.includeJsr
    ? `
The release workflow also publishes to [JSR](https://jsr.io). Link the GitHub
repository on your package's JSR settings page so the workflow's OIDC token is
accepted, or run \`${packageManagerConfig[config.packageManager].runPrefix} jsr:publish\` locally.
`
    : "";

  return `
## Releasing

Publishing is automated: bump the version with \`pnpm version\`, push, and
publish a GitHub release. The release workflow validates the package and runs
\`npm publish\` with [provenance](https://docs.npmjs.com/generating-provenance-statements).

The workflow authenticates with npm
[trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) instead
of a long-lived token. Before the first release, add a trusted publisher on
npmjs.com${trustedPublisherHint} pointing at the \`release.yml\` GitHub Actions
workflow.
${jsrSection}`;
};

const buildReadmeBadges = (config: ScaffoldConfig): string => {
  const badges = [
    `[![npm version](https://img.shields.io/npm/v/${config.projectName}.svg)](https://www.npmjs.com/package/${config.projectName})`,
  ];

  if (hasGitHubWorkflows(config)) {
    const normalizedUrl = normalizeGitHubUrl(config.githubRepoUrl);
    badges.push(
      `[![CI](${normalizedUrl}/actions/workflows/ci.yml/badge.svg)](${normalizedUrl}/actions/workflows/ci.yml)`,
    );
  }

  if (config.includeJsr) {
    badges.push(
      `[![JSR](https://jsr.io/badges/${config.projectName})](https://jsr.io/${config.projectName})`,
    );
  }

  badges.push(buildLicenseBadge(config.license));

  return badges.join("\n");
};

const buildLicenseBadge = (license: LicenseName): string => {
  const escapedLicense = license.replaceAll("-", "--");

  return `[![License: ${license}](https://img.shields.io/badge/license-${escapedLicense}-blue.svg)](LICENSE)`;
};
