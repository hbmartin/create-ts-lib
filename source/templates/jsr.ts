import { inlineJsonArray } from "./render.js";
import type { ScaffoldConfig } from "./scaffold-config.js";

/**
 * JSR publishes TypeScript sources directly, so the manifest points at
 * `source/` rather than the built `dist/` output.
 *
 * Written out rather than stringified so the short arrays stay inline; see
 * `inlineJsonArray`.
 */
export const buildJsrJson = (config: ScaffoldConfig): string => `{
  "name": ${JSON.stringify(config.projectName)},
  "version": "0.1.0",
  "exports": "./source/index.ts",
  "publish": {
    "include": ${inlineJsonArray(["source/**/*.ts", "README.md", "LICENSE"])},
    "exclude": ${inlineJsonArray(["**/*.test.ts"])}
  }
}
`;
