import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getUserConfigPath, loadUserConfig } from "../source/user-config.js";

const writeUserConfig = async (content: string): Promise<string> => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "create-ts-lib-user-config-"));
  const configDirectory = join(tempDirectory, "create-ts-lib");
  await mkdir(configDirectory);
  const configPath = join(configDirectory, "config.json");
  await writeFile(configPath, content, "utf8");

  return configPath;
};

describe("getUserConfigPath", () => {
  it("prefers XDG_CONFIG_HOME when set", () => {
    expect(getUserConfigPath({ XDG_CONFIG_HOME: "/custom/config" })).toBe(
      "/custom/config/create-ts-lib/config.json",
    );
  });

  it("falls back to ~/.config when XDG_CONFIG_HOME is unset or empty", () => {
    const expected = join(homedir(), ".config", "create-ts-lib", "config.json");

    expect(getUserConfigPath({})).toBe(expected);
    expect(getUserConfigPath({ XDG_CONFIG_HOME: "" })).toBe(expected);
  });
});

describe("loadUserConfig", () => {
  it("returns an empty config when the file does not exist", async () => {
    const warnings: string[] = [];

    await expect(
      loadUserConfig((message) => warnings.push(message), "/does/not/exist/config.json"),
    ).resolves.toEqual({});
    expect(warnings).toEqual([]);
  });

  it("returns an empty config when a path component is a regular file", async () => {
    const warnings: string[] = [];
    const tempDirectory = await mkdtemp(join(tmpdir(), "create-ts-lib-user-config-"));
    const filePath = join(tempDirectory, "not-a-directory");
    await writeFile(filePath, "plain file\n", "utf8");

    await expect(
      loadUserConfig((message) => warnings.push(message), join(filePath, "config.json")),
    ).resolves.toEqual({});
    expect(warnings).toEqual([]);
  });

  it("warns and ignores config paths that cannot be read", async () => {
    const warnings: string[] = [];
    const tempDirectory = await mkdtemp(join(tmpdir(), "create-ts-lib-user-config-"));
    const configPath = join(tempDirectory, "config.json");
    await mkdir(configPath);

    await expect(loadUserConfig((message) => warnings.push(message), configPath)).resolves.toEqual(
      {},
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("could not read file");
  });

  it("loads and validates personal defaults", async () => {
    const warnings: string[] = [];
    const configPath = await writeUserConfig(
      JSON.stringify({
        author: "Ada Lovelace <ada@example.com>",
        bundler: "tsdown",
        includeCodecov: false,
        license: "MIT",
        lintFormatTooling: "biome",
        packageManager: "npm",
      }),
    );

    await expect(loadUserConfig((message) => warnings.push(message), configPath)).resolves.toEqual({
      author: "Ada Lovelace <ada@example.com>",
      bundler: "tsdown",
      includeCodecov: false,
      license: "MIT",
      lintFormatTooling: "biome",
      packageManager: "npm",
    });
    expect(warnings).toEqual([]);
  });

  it("warns and ignores files that are not valid JSON", async () => {
    const warnings: string[] = [];
    const configPath = await writeUserConfig("not json");

    await expect(loadUserConfig((message) => warnings.push(message), configPath)).resolves.toEqual(
      {},
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("not valid JSON");
  });

  it("warns and ignores files with invalid or unknown fields", async () => {
    const warnings: string[] = [];
    const invalidLicense = await writeUserConfig(JSON.stringify({ license: "GPL-3.0" }));
    const unknownField = await writeUserConfig(JSON.stringify({ projectName: "my-lib" }));

    await expect(
      loadUserConfig((message) => warnings.push(message), invalidLicense),
    ).resolves.toEqual({});
    await expect(
      loadUserConfig((message) => warnings.push(message), unknownField),
    ).resolves.toEqual({});
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("license");
    expect(warnings[1]).toContain("projectName");
  });
});
