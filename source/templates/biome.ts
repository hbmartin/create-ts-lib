import { readFileSync } from "node:fs";

const cliOverride = `    {
      "includes": ["source/cli.ts"],
      "linter": {
        "rules": {
          "correctness": {
            "noNodejsModules": "off",
          },
          "style": {
            "noDefaultExport": "off",
            "noProcessEnv": "off",
          },
          "suspicious": {
            "noConsole": "off",
          },
        },
      },
    },
`;

export const renderBiomeJsonc = (includeCli: boolean): string => {
  const template = readFileSync(new URL("./assets/biome.jsonc.tmpl", import.meta.url), "utf8");
  const cliOverrideEntry = includeCli ? cliOverride : "";

  return template.replace("{{CLI_OVERRIDE}}", cliOverrideEntry);
};
