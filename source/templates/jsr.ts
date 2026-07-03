import type { ScaffoldConfig } from "./scaffold-config.js";

/**
 * JSR publishes TypeScript sources directly, so the manifest points at
 * `source/` rather than the built `dist/` output.
 */
export const buildJsrJson = (config: ScaffoldConfig): string => {
  const jsrJson = {
    name: config.projectName,
    version: "0.1.0",
    exports: "./source/index.ts",
    publish: {
      include: ["source/**/*.ts", "README.md", "LICENSE"],
      exclude: ["**/*.test.ts"],
    },
  };

  return `${JSON.stringify(jsrJson, null, 2)}\n`;
};
