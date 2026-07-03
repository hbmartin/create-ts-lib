import { readFileSync } from "node:fs";

// Formatted the way Biome itself formats JSONC (2-space indent, no trailing
// commas) so a generated project passes its own `biome format` check.
const cliOverride = `,
    {
      "includes": ["source/cli.ts"],
      "linter": {
        "rules": {
          "correctness": {
            "noNodejsModules": "off"
          },
          "style": {
            "noDefaultExport": "off",
            "noProcessEnv": "off"
          },
          "suspicious": {
            "noConsole": "off"
          }
        }
      }
    }`;

export const renderBiomeJsonc = (includeCli: boolean): string => {
  const template = readFileSync(new URL("./assets/biome.jsonc.tmpl", import.meta.url), "utf8");
  const cliOverrideEntry = includeCli ? cliOverride : "";

  return template.replace("{{CLI_OVERRIDE}}", cliOverrideEntry);
};
