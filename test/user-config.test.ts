import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getUserConfigPath,
  loadUserConfig,
  saveUserConfig,
  setUserConfigValue,
  type UserConfig,
  unsetUserConfigValue,
  userConfigKeys,
} from "../source/user-config.js";
import { createTempDirectory } from "./helpers/temp-directory.js";

const neverWarn = (): void => {
  throw new Error("Did not expect a warning");
};

const writeUserConfig = async (content: string): Promise<string> => {
  const tempDirectory = await createTempDirectory("create-ts-lib-user-config-");
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
    const tempDirectory = await createTempDirectory("create-ts-lib-user-config-");
    const filePath = join(tempDirectory, "not-a-directory");
    await writeFile(filePath, "plain file\n", "utf8");

    await expect(
      loadUserConfig((message) => warnings.push(message), join(filePath, "config.json")),
    ).resolves.toEqual({});
    expect(warnings).toEqual([]);
  });

  it("warns and ignores config paths that cannot be read", async () => {
    const warnings: string[] = [];
    const tempDirectory = await createTempDirectory("create-ts-lib-user-config-");
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

describe("saveUserConfig", () => {
  const configPathIn = async (): Promise<string> => {
    const tempDirectory = await createTempDirectory("create-ts-lib-save-config-");

    // Nested directory that does not exist yet, so the write has to create it.
    return join(tempDirectory, "create-ts-lib", "config.json");
  };

  it("creates the config directory and round-trips through loadUserConfig", async () => {
    const configPath = await configPathIn();

    await saveUserConfig({ includeZod: true, license: "MIT" }, configPath);

    await expect(loadUserConfig(neverWarn, configPath)).resolves.toEqual({
      includeZod: true,
      license: "MIT",
    });
    await expect(readFile(configPath, "utf8")).resolves.toMatch(/\n$/u);
  });

  it("refuses to write an invalid config", async () => {
    const configPath = await configPathIn();

    await expect(
      saveUserConfig({ license: "GPL-3.0" } as unknown as UserConfig, configPath),
    ).rejects.toThrow("Refusing to write invalid config");
  });

  it("leaves no temp file behind", async () => {
    const configPath = await configPathIn();

    await saveUserConfig({ license: "ISC" }, configPath);

    const entries = await readdir(dirname(configPath));
    expect(entries).toEqual(["config.json"]);
  });
});

describe("setUserConfigValue", () => {
  it("coerces boolean keys from their string form", () => {
    expect(setUserConfigValue({}, "includeZod", "true")).toEqual({ includeZod: true });
    expect(setUserConfigValue({}, "includeCli", "false")).toEqual({ includeCli: false });
  });

  it("keeps other keys intact", () => {
    expect(setUserConfigValue({ author: "Ada" }, "license", "MIT")).toEqual({
      author: "Ada",
      license: "MIT",
    });
  });

  it("rejects unknown keys and invalid values", () => {
    expect(() => setUserConfigValue({}, "nope", "x")).toThrow("Unknown config key: nope");
    expect(() => setUserConfigValue({}, "includeZod", "yes")).toThrow(
      "Invalid value for includeZod",
    );
    expect(() => setUserConfigValue({}, "license", "GPL-3.0")).toThrow("Invalid value for license");
  });
});

describe("unsetUserConfigValue", () => {
  it("removes only the requested key", () => {
    expect(unsetUserConfigValue({ author: "Ada", license: "MIT" }, "license")).toEqual({
      author: "Ada",
    });
  });

  it("rejects unknown keys", () => {
    expect(() => unsetUserConfigValue({}, "nope")).toThrow("Unknown config key: nope");
  });
});

describe("userConfigKeys", () => {
  it("lists every schema key in sorted order", () => {
    expect(userConfigKeys).toEqual([...userConfigKeys].sort());
    expect(userConfigKeys).toContain("includeCommunityFiles");
    expect(userConfigKeys).not.toContain("projectName");
  });
});
