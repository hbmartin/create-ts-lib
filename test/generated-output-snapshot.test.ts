import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import generatorPackageJson from "../package.json" with { type: "json" };
import {
  buildProjectFiles,
  type GeneratedFile,
  type ScaffoldConfig,
} from "../source/templates/files.js";
import { stateFileName } from "../source/templates/state.js";

const baseSnapshotConfig: ScaffoldConfig = {
  author: "Harold Martin <harold@example.com>",
  bundler: "tsc",
  copyrightYear: "2026",
  description: "A generated TypeScript library",
  githubRepoUrl: "https://github.com/hbmartin/generated-lib",
  includeCli: false,
  includeCodecov: true,
  includeCommunityFiles: false,
  includeJsr: false,
  includeSecurityWorkflows: false,
  includeZod: false,
  license: "MIT",
  lintFormatTooling: "oxlint-oxfmt",
  packageManager: "pnpm",
  projectName: "generated-lib",
  workspaceMode: false,
};

const generatedProjectSnapshotCases = [
  {
    config: {
      ...baseSnapshotConfig,
      includeCli: true,
      includeZod: true,
      projectName: "@hbmartin/validated-cli",
    },
    snapshotName: "pnpm-cli-zod-mit",
  },
  {
    config: {
      ...baseSnapshotConfig,
      author: "",
      description: "",
      githubRepoUrl: "",
      includeCodecov: false,
      license: "UNLICENSED",
      packageManager: "npm",
      projectName: "npm-minimal",
    },
    snapshotName: "npm-minimal-unlicensed",
  },
  {
    config: {
      ...baseSnapshotConfig,
      includeCli: true,
      includeCodecov: false,
      license: "ISC",
      lintFormatTooling: "biome",
      projectName: "biome-library",
    },
    snapshotName: "biome-isc",
  },
  {
    config: {
      ...baseSnapshotConfig,
      githubRepoUrl: "",
      includeCodecov: false,
      license: "Apache-2.0",
      projectName: "apache-library",
    },
    snapshotName: "apache-license",
  },
  {
    config: {
      ...baseSnapshotConfig,
      bundler: "tsdown",
      includeCli: true,
      includeCommunityFiles: true,
      includeJsr: true,
      includeSecurityWorkflows: true,
      projectName: "@hbmartin/full-featured-lib",
    },
    snapshotName: "tsdown-jsr-security",
  },
] satisfies Array<{ config: ScaffoldConfig; snapshotName: string }>;

describe("generated project file snapshots", () => {
  for (const { config, snapshotName } of generatedProjectSnapshotCases) {
    it(`matches the ${snapshotName} golden file`, async () => {
      await expect(renderGeneratedProjectSnapshot(config)).toMatchFileSnapshot(
        snapshotPath(snapshotName),
      );
    });
  }
});

const snapshotPath = (snapshotName: string): string =>
  fileURLToPath(new URL(`./__snapshots__/generated-output/${snapshotName}.snap`, import.meta.url));

// `buildProjectFiles` is a pure function of its config -- the LICENSE year comes
// from `config.copyrightYear` -- so this needs no clock control.
const renderGeneratedProjectSnapshot = (config: ScaffoldConfig): string =>
  serializeGeneratedFiles(buildProjectFiles(config));

const serializeGeneratedFiles = (files: GeneratedFile[]): string =>
  files
    .map((file) => {
      const content = normalizeSnapshotContent(file);
      const executable = file.executable === true ? "true" : "false";

      return `===== ${file.path} =====
executable: ${executable}

${content}`;
    })
    .join("\n");

// The scaffold state file embeds the generator version; redact it so version
// bumps do not churn golden files.
const normalizeSnapshotContent = (file: GeneratedFile): string => {
  const content = file.content.endsWith("\n") ? file.content : `${file.content}\n`;

  if (file.path !== stateFileName) {
    return content;
  }

  return content.replace(
    `"version": "${generatorPackageJson.version}"`,
    '"version": "<generator-version>"',
  );
};
