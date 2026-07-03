import type { LintFormatTooling } from "../lint-format-tooling.js";
import type { GeneratedFile, ScaffoldConfig } from "./scaffold-config.js";

interface VsCodeTooling {
  extensionId: string;
  formatterId: string;
  settings: Record<string, unknown>;
}

const vsCodeTooling = {
  biome: {
    extensionId: "biomejs.biome",
    formatterId: "biomejs.biome",
    settings: {
      "editor.codeActionsOnSave": {
        "source.fixAll.biome": "explicit",
        "source.organizeImports.biome": "explicit",
      },
    },
  },
  "oxlint-oxfmt": {
    extensionId: "oxc.oxc-vscode",
    formatterId: "oxc.oxc-vscode",
    settings: {
      "oxc.enable": true,
    },
  },
} satisfies Record<LintFormatTooling, VsCodeTooling>;

export const buildVsCodeFiles = (config: ScaffoldConfig): GeneratedFile[] => {
  const tooling = vsCodeTooling[config.lintFormatTooling];
  const recommendations = [tooling.extensionId, "vitest.explorer"];
  // Short arrays stay on one line so Biome-formatted projects pass their own
  // format check without rewriting these files.
  const extensionsContent = `{
  "recommendations": ${JSON.stringify(recommendations).replaceAll('","', '", "')}
}
`;
  const settings = {
    "editor.defaultFormatter": tooling.formatterId,
    "editor.formatOnSave": true,
    ...tooling.settings,
    "typescript.tsdk": "node_modules/typescript/lib",
  };

  return [
    {
      content: extensionsContent,
      path: ".vscode/extensions.json",
    },
    {
      content: `${JSON.stringify(settings, null, 2)}\n`,
      path: ".vscode/settings.json",
    },
  ];
};
