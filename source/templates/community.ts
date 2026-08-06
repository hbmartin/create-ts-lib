import { normalizeGitHubUrl } from "../name-helpers.js";
import { renderTemplate } from "./render.js";
import {
  extractAuthorEmail,
  type GeneratedFile,
  packageManagerConfig,
  type ScaffoldConfig,
} from "./scaffold-config.js";

// Contributor Covenant's own placeholder. Emitting it verbatim makes the gap
// obvious to the maintainer instead of inventing a contact address.
const missingContactPlaceholder = "[INSERT CONTACT METHOD]";

const buildContact = (config: ScaffoldConfig): string =>
  extractAuthorEmail(config.author) ?? missingContactPlaceholder;

const buildSecurityReportInstructions = (config: ScaffoldConfig): string => {
  if (config.githubRepoUrl.length > 0) {
    const normalizedUrl = normalizeGitHubUrl(config.githubRepoUrl);

    return `Please report suspected vulnerabilities through GitHub's private vulnerability
reporting:

${normalizedUrl}/security/advisories/new`;
  }

  return `Please report suspected vulnerabilities privately to ${buildContact(config)}.`;
};

/**
 * The three community-health files OpenSSF Scorecard grades. Emitted only when
 * `includeCommunityFiles` is set, so projects that inherit them from a parent
 * repository are not given duplicates.
 */
export const buildCommunityFiles = (config: ScaffoldConfig): GeneratedFile[] => {
  if (!config.includeCommunityFiles) {
    return [];
  }

  const pmConfig = packageManagerConfig[config.packageManager];

  return [
    {
      content: renderTemplate("community/CODE_OF_CONDUCT.md.tmpl", {
        CONTACT: buildContact(config),
      }),
      path: "CODE_OF_CONDUCT.md",
    },
    {
      content: renderTemplate("community/CONTRIBUTING.md.tmpl", {
        PACKAGE_MANAGER: config.packageManager,
        PROJECT_NAME: config.projectName,
        RUN_PREFIX: pmConfig.runPrefix,
      }),
      path: "CONTRIBUTING.md",
    },
    {
      content: renderTemplate("community/SECURITY.md.tmpl", {
        SECURITY_REPORT_INSTRUCTIONS: buildSecurityReportInstructions(config),
      }),
      path: "SECURITY.md",
    },
  ];
};
