import { githubActionRefs, pnpmVersion, tsgoProbeCommand } from "./generated-versions.js";
import { renderTemplate } from "./render.js";
import type { ScaffoldConfig } from "./scaffold-config.js";

export const buildCiWorkflow = (config: ScaffoldConfig): string => {
  const codecovStep = config.includeCodecov
    ? `
      - name: Upload coverage to Codecov
        if: matrix.node-version == '24'
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
    PACKAGE_MANAGER_SETUP: `      - uses: ${githubActionRefs.pnpmSetup}
        with:
          version: ${pnpmVersion}`,
    PUBLINT_COMMAND: "pnpm run publint",
    RUN_PREFIX: "pnpm run",
    TSGO_PROBE_COMMAND: tsgoProbeCommand,
  });
};

export const buildReleaseWorkflow = (config: ScaffoldConfig): string => {
  const jsrPublishStep = config.includeJsr
    ? `
      - name: Publish to JSR
        run: pnpm dlx jsr publish`
    : "";

  return renderTemplate("github/release.yml.tmpl", {
    ACTION_CHECKOUT: githubActionRefs.checkout,
    ACTION_PNPM_SETUP: githubActionRefs.pnpmSetup,
    ACTION_SETUP_NODE: githubActionRefs.setupNode,
    ACTION_SETUP_UV: githubActionRefs.setupUv,
    JSR_PUBLISH_STEP: jsrPublishStep,
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
