import { ciNodeVersions, type NodeTarget } from "../node-target.js";
import { githubActionRefs, pnpmVersion } from "./generated-versions.js";
import { renderTemplate } from "./render.js";
import type { ScaffoldConfig } from "./scaffold-config.js";

// YAML flow-sequence formatting is a workflow concern, so it lives here rather
// than beside the matrix derivation in node-target.ts.
const formatNodeVersionMatrix = (nodeTarget: NodeTarget): string =>
  `[${ciNodeVersions(nodeTarget)
    .map((nodeVersion) => `"${nodeVersion}"`)
    .join(", ")}]`;

export const buildCiWorkflow = (config: ScaffoldConfig): string => {
  const codecovStep = config.includeCodecov
    ? `
      - name: Upload coverage to Codecov
        if: matrix.node-version == '${config.nodeTarget}'
        uses: ${githubActionRefs.codecov}
        with:
          token: \${{ secrets.CODECOV_TOKEN }}
          fail_ci_if_error: true`
    : "";

  return renderTemplate("github/ci.yml.tmpl", {
    ACTION_CHECKOUT: githubActionRefs.checkout,
    ACTION_SETUP_NODE: githubActionRefs.setupNode,
    ACTION_SETUP_UV: githubActionRefs.setupUv,
    AUDIT_COMMAND: "pnpm audit --prod",
    BUILD_COMMAND: "pnpm run build",
    CACHE: "pnpm",
    CODECOV_STEP: codecovStep,
    INSTALL_CI_COMMAND: "pnpm install --frozen-lockfile",
    NODE_VERSION_MATRIX: formatNodeVersionMatrix(config.nodeTarget),
    PACKAGE_MANAGER_SETUP: `      - uses: ${githubActionRefs.pnpmSetup}
        with:
          version: ${pnpmVersion}`,
    PUBLINT_COMMAND: "pnpm run publint",
    RUN_PREFIX: "pnpm run",
  });
};

export const buildReleaseWorkflow = (config: ScaffoldConfig): string => {
  const jsrPublishStep = config.includeJsr
    ? `
      - name: Publish to JSR
        run: pnpm run jsr:publish`
    : "";

  return renderTemplate("github/release.yml.tmpl", {
    ACTION_CHECKOUT: githubActionRefs.checkout,
    ACTION_PNPM_SETUP: githubActionRefs.pnpmSetup,
    ACTION_SETUP_NODE: githubActionRefs.setupNode,
    ACTION_SETUP_UV: githubActionRefs.setupUv,
    JSR_PUBLISH_STEP: jsrPublishStep,
    NODE_TARGET: config.nodeTarget,
    PNPM_VERSION: pnpmVersion,
  });
};

export const buildScorecardWorkflow = (): string =>
  renderTemplate("github/scorecard.yml.tmpl", {
    ACTION_CHECKOUT: githubActionRefs.checkout,
    ACTION_CODEQL_UPLOAD_SARIF: githubActionRefs.codeqlUploadSarif,
    ACTION_SCORECARD: githubActionRefs.scorecard,
  });

export const buildCodeqlWorkflow = (): string =>
  renderTemplate("github/codeql.yml.tmpl", {
    ACTION_CHECKOUT: githubActionRefs.checkout,
    ACTION_CODEQL_ANALYZE: githubActionRefs.codeqlAnalyze,
    ACTION_CODEQL_INIT: githubActionRefs.codeqlInit,
  });
