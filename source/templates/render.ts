import { readFileSync } from "node:fs";

const readTemplate = (relativePath: string): string =>
  readFileSync(new URL(`./assets/${relativePath}`, import.meta.url), "utf8");

const unresolvedTemplatePlaceholderPattern = /(?<!\$)\{\{[^{}]*\}\}/gu;

/**
 * A JSON array printed on one line, spaced the way Biome's formatter prints it.
 *
 * Biome collapses a short array onto one line while `JSON.stringify` always
 * breaks one across lines, and a Biome-tooled project runs that formatter over
 * the manifests generated for it -- so a stringified short array ships a
 * project that fails its own `format` check before anyone has touched it. Every
 * generated manifest carrying a short array builds it through here.
 * `package.json` is the exception and is deliberately left to `JSON.stringify`:
 * Biome always expands that file, whatever the array length.
 *
 * The guarantee is enforced by `test/generated-formatting.test.ts`, which runs
 * the real formatters over the real rendered output rather than trusting this
 * helper to model them.
 */
export const inlineJsonArray = (values: readonly string[]): string =>
  `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;

export const renderTemplate = (
  relativePath: string,
  replacements: Record<string, string> = {},
): string => {
  let content = readTemplate(relativePath);

  for (const [key, value] of Object.entries(replacements)) {
    content = content.replaceAll(`{{${key}}}`, () => value);
  }

  const unresolvedPlaceholders = Array.from(
    new Set(content.match(unresolvedTemplatePlaceholderPattern) ?? []),
  );
  if (unresolvedPlaceholders.length > 0) {
    throw new Error(
      `Unresolved template placeholder(s) in ${relativePath}: ${unresolvedPlaceholders.join(", ")}`,
    );
  }

  return content;
};
