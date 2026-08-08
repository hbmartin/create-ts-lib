import type { LintFormatTooling } from "../lint-format-tooling.js";
import { inlineJsonArray } from "./render.js";
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
  const extensionsContent = `{
  "recommendations": ${inlineJsonArray([tooling.extensionId, "vitest.explorer"])}
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
