import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildProjectFiles, type ScaffoldConfig } from "../source/templates/files.js";
import { createTempDirectory } from "./helpers/temp-directory.js";

// Nothing in this repository formats the template assets. oxfmt ignores JSON,
// JSONC, YAML and Markdown; Biome excludes `source/templates/assets` entirely;
// and the `.tmpl` extension keeps the rest out of both. A scaffolded project
// then runs the formatter we chose *for it* over exactly those files, so an
// asset that formatter would reprint ships a project whose own `check` fails on
// the first run.
//
// That is how `.fallowrc.jsonc` broke every Biome project: its
// `boundaries.rules` array was written across four lines and Biome prints it on
// one. oxfmt never looked at the file, so the repository stayed green and only
// the two Biome legs of the CI smoke matrix noticed, minutes in and after an
// install. These tests run the real formatter over the real rendered output.

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const biomeBin = join(repositoryRoot, "node_modules/@biomejs/biome/bin/biome");
const oxfmtBin = join(repositoryRoot, "node_modules/oxfmt/bin/oxfmt");
const formatTestTimeout = 30_000;

// Both formatters check by default and reprint only when asked, so neither
// command below can pass by mutating the fixture into agreement.
const formatterCommand = {
  biome: [biomeBin, "format", "."],
  "oxlint-oxfmt": [oxfmtBin, "--check", "."],
} as const;

const baseConfig: ScaffoldConfig = {
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
  nodeTarget: "24",
  packageManager: "pnpm",
  projectName: "generated-lib",
  // Workspace mode is deliberately absent from every case below: it withholds
  // the root-owned files, including `.gitignore`, and Biome's `useIgnoreFile`
  // then fails on the missing ignore file rather than on formatting. Such a
  // project is formatted by the tooling its workspace root owns.
  workspaceMode: false,
};

const everyFeatureOverrides = {
  bundler: "tsdown",
  includeCli: true,
  includeCommunityFiles: true,
  includeJsr: true,
  includeSecurityWorkflows: true,
  includeZod: true,
} as const satisfies Partial<ScaffoldConfig>;

const formattingCases = [
  { name: "Biome, minimal answers", overrides: { lintFormatTooling: "biome" } },
  {
    name: "Biome, every feature enabled",
    overrides: { ...everyFeatureOverrides, lintFormatTooling: "biome" },
  },
  { name: "oxfmt, minimal answers", overrides: {} },
  { name: "oxfmt, every feature enabled", overrides: everyFeatureOverrides },
] as const satisfies { name: string; overrides: Partial<ScaffoldConfig> }[];

const renderProject = async (
  config: ScaffoldConfig,
  extraFiles: Record<string, string> = {},
): Promise<string> => {
  const projectDirectory = await createTempDirectory("create-ts-lib-format-");

  const files: Record<string, string> = Object.fromEntries([
    ...buildProjectFiles(config).map((file) => [file.path, file.content]),
    ...Object.entries(extraFiles),
  ]);

  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(projectDirectory, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }

  return projectDirectory;
};

const runFormatter = async (
  config: ScaffoldConfig,
  extraFiles: Record<string, string> = {},
): Promise<{ output: string; status: number | null }> => {
  const projectDirectory = await renderProject(config, extraFiles);
  const [tool, ...toolArguments] = formatterCommand[config.lintFormatTooling];

  const result = spawnSync(process.execPath, [tool, ...toolArguments], {
    cwd: projectDirectory,
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  return { output: `${result.stdout}${result.stderr}`, status: result.status };
};

// Reprinted by both formatters, so one probe serves either tool.
const misformattedProbe = "export const probe    =     {a:1,\n  b:  2};\n";

describe("generated project formatting", () => {
  for (const { name, overrides } of formattingCases) {
    const config: ScaffoldConfig = { ...baseConfig, ...overrides };

    it(
      `is clean under the formatter it generates (${name})`,
      async () => {
        const { output, status } = await runFormatter(config);

        expect(status, output).toBe(0);
      },
      formatTestTimeout,
    );

    // The control. A formatter that silently matched no files, or that was
    // invoked in write mode, would report the case above as clean no matter
    // what the assets contain.
    it(
      `reports a misformatted file in the same project (${name})`,
      async () => {
        const { output, status } = await runFormatter(config, {
          "source/probe.ts": misformattedProbe,
        });

        expect(status, output).not.toBe(0);
        expect(output).toContain("probe.ts");
      },
      formatTestTimeout,
    );
  }
});
