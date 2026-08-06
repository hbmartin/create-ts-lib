import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { detectWorkspaceRoot } from "../source/workspace-detection.js";

const execFileAsync = promisify(execFile);

interface WorkspaceFixtureOptions {
  /** Written to the repository root when provided. */
  packageJson?: unknown;
  pnpmWorkspace?: string;
  /** Skip `git init`, so the fixture is not inside a repository. */
  withoutGit?: boolean;
}

const createFixture = async (
  options: WorkspaceFixtureOptions = {},
): Promise<{ packagesDirectory: string; repositoryRoot: string }> => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "create-ts-lib-workspace-"));
  const packagesDirectory = join(repositoryRoot, "packages");
  await mkdir(packagesDirectory, { recursive: true });

  if (options.pnpmWorkspace !== undefined) {
    await writeFile(join(repositoryRoot, "pnpm-workspace.yaml"), options.pnpmWorkspace, "utf8");
  }

  if (options.packageJson !== undefined) {
    await writeFile(
      join(repositoryRoot, "package.json"),
      `${JSON.stringify(options.packageJson, null, 2)}\n`,
      "utf8",
    );
  }

  if (options.withoutGit !== true) {
    await execFileAsync("git", ["init"], { cwd: repositoryRoot });
  }

  return { packagesDirectory, repositoryRoot };
};

describe("detectWorkspaceRoot", () => {
  it("finds a pnpm workspace from a nested directory", async () => {
    const { packagesDirectory, repositoryRoot } = await createFixture({
      pnpmWorkspace: 'packages:\n  - "packages/*"\n',
    });

    const detected = await detectWorkspaceRoot(packagesDirectory);

    expect(detected?.manifest).toBe("pnpm-workspace.yaml");
    expect(detected?.directory).toBe(await realpath(repositoryRoot));
  });

  // Every one of these is a valid pnpm-workspace.yaml. Missing any of them
  // means a real monorepo is never offered workspace mode.
  it.each([
    ["flow sequence", 'packages: ["packages/*"]\n'],
    ["single-quoted flow sequence", "packages: ['packages/*', 'apps/*']\n"],
    ["blank line before the sequence", 'packages:\n\n  - "packages/*"\n'],
    ["comment before the sequence", 'packages:\n  # our packages\n  - "packages/*"\n'],
    ["comment between entries", 'packages:\n  - "apps/*"\n  # and the rest\n  - "packages/*"\n'],
    ["trailing comment on an entry", 'packages:\n  - "packages/*" # everything\n'],
  ])("finds a pnpm workspace declared as a %s", async (_name, pnpmWorkspace) => {
    const { packagesDirectory } = await createFixture({ pnpmWorkspace });

    const detected = await detectWorkspaceRoot(packagesDirectory);

    expect(detected?.manifest).toBe("pnpm-workspace.yaml");
  });

  it.each([
    ["flow sequence", 'packages: ["."]\n'],
    ["comment before the sequence", 'packages:\n  # just this one\n  - "."\n'],
  ])("still ignores the single-package idiom declared as a %s", async (_name, pnpmWorkspace) => {
    const { packagesDirectory } = await createFixture({ pnpmWorkspace });

    await expect(detectWorkspaceRoot(packagesDirectory)).resolves.toBeUndefined();
  });

  it("stops at the next top-level key", async () => {
    // `onlyBuiltDependencies` is a sequence too; absorbing it would turn a
    // single-package project into a false workspace.
    const { packagesDirectory } = await createFixture({
      pnpmWorkspace: 'packages:\n  - "."\n\nonlyBuiltDependencies:\n  - esbuild\n',
    });

    await expect(detectWorkspaceRoot(packagesDirectory)).resolves.toBeUndefined();
  });

  it("finds a package.json workspaces array", async () => {
    const { packagesDirectory } = await createFixture({
      packageJson: { name: "root", workspaces: ["packages/*"] },
    });

    const detected = await detectWorkspaceRoot(packagesDirectory);

    expect(detected?.manifest).toBe("package.json");
  });

  it("finds the yarn object form of workspaces", async () => {
    const { packagesDirectory } = await createFixture({
      packageJson: { name: "root", workspaces: { packages: ["packages/*"] } },
    });

    const detected = await detectWorkspaceRoot(packagesDirectory);

    expect(detected?.manifest).toBe("package.json");
  });

  it('ignores the single-package `packages: ["."]` pnpm idiom', async () => {
    // This is exactly what the generator emits for a standalone project, so
    // treating it as a workspace would make every generated project look like a
    // monorepo root to the next scaffold.
    const { packagesDirectory } = await createFixture({
      pnpmWorkspace: 'packages:\n  - "."\n\nallowBuilds:\n  lefthook: true\n',
    });

    await expect(detectWorkspaceRoot(packagesDirectory)).resolves.toBeUndefined();
  });

  it("ignores a package.json that only lists itself", async () => {
    const { packagesDirectory } = await createFixture({
      packageJson: { name: "root", workspaces: ["."] },
    });

    await expect(detectWorkspaceRoot(packagesDirectory)).resolves.toBeUndefined();
  });

  it("returns undefined outside a git repository", async () => {
    const { packagesDirectory } = await createFixture({
      pnpmWorkspace: 'packages:\n  - "packages/*"\n',
      withoutGit: true,
    });

    await expect(detectWorkspaceRoot(packagesDirectory)).resolves.toBeUndefined();
  });

  it("does not search above the repository root", async () => {
    // The workspace manifest sits outside the repository, so it must not match
    // even though it is an ancestor directory.
    const outerDirectory = await mkdtemp(join(tmpdir(), "create-ts-lib-outer-"));
    await writeFile(
      join(outerDirectory, "pnpm-workspace.yaml"),
      'packages:\n  - "packages/*"\n',
      "utf8",
    );
    const repositoryRoot = join(outerDirectory, "inner-repo");
    await mkdir(repositoryRoot);
    await execFileAsync("git", ["init"], { cwd: repositoryRoot });

    await expect(detectWorkspaceRoot(repositoryRoot)).resolves.toBeUndefined();
  });

  it("walks up from a directory that does not exist yet", async () => {
    const { packagesDirectory } = await createFixture({
      pnpmWorkspace: 'packages:\n  - "packages/*"\n',
    });

    const detected = await detectWorkspaceRoot(join(packagesDirectory, "not-created-yet"));

    expect(detected?.manifest).toBe("pnpm-workspace.yaml");
  });

  it("ignores an unparseable package.json", async () => {
    const { packagesDirectory, repositoryRoot } = await createFixture();
    await writeFile(join(repositoryRoot, "package.json"), "{ not json", "utf8");

    await expect(detectWorkspaceRoot(packagesDirectory)).resolves.toBeUndefined();
  });
});
