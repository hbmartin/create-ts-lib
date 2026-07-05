import { readFileSync } from "node:fs";

const readTemplate = (relativePath: string): string =>
  readFileSync(new URL(`./assets/${relativePath}`, import.meta.url), "utf8");

const unresolvedTemplatePlaceholderPattern = /(?<!\$)\{\{[^{}]*\}\}/gu;

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
