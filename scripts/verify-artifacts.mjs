import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const assetsRoot = join(repositoryRoot, "source", "templates", "assets");
const distRoot = join(repositoryRoot, "dist");

const compiledArtifacts = ["index.js", "index.d.ts", "cli.js", "cli.d.ts"];

const listFilesRecursively = async (directory) => {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)));
};

const assertFileExists = async (path) => {
  try {
    const stats = await stat(path);
    if (!stats.isFile()) {
      throw new Error("not a file");
    }
  } catch {
    throw new Error(`Missing build artifact: ${relative(repositoryRoot, path)}`);
  }
};

// Verify compiled entry points, then every template asset. Deriving the
// asset list from source/templates/assets/** means new templates are
// covered automatically instead of relying on a hand-maintained sample.
const assetFiles = await listFilesRecursively(assetsRoot);
if (assetFiles.length === 0) {
  throw new Error(`No template assets found under ${relative(repositoryRoot, assetsRoot)}`);
}

for (const artifact of compiledArtifacts) {
  await assertFileExists(join(distRoot, artifact));
}

for (const assetFile of assetFiles) {
  await assertFileExists(join(distRoot, "templates", "assets", assetFile));
}

process.stdout.write(
  `Verified ${compiledArtifacts.length} compiled artifacts and ${assetFiles.length} template assets in dist${sep}.\n`,
);
