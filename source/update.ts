import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { isErrorWithCode, isFileNotFoundError } from "./filesystem-errors.js";
import { buildProjectFiles } from "./templates/files.js";
import type { GeneratedFile } from "./templates/scaffold-config.js";
import {
  hashFileContent,
  type ScaffoldState,
  scaffoldStateSchema,
  stateFileName,
} from "./templates/state.js";

export type UpdateFileStatus = "create" | "skip-modified" | "up-to-date" | "update";

export interface UpdatePlanEntry {
  /**
   * Where the previous contents were kept, relative to the target directory and
   * set only on entries that were actually backed up. Usually `<path>.orig`, but
   * a taken name pushes it to `<path>.orig.1` and so on, so callers must report
   * this rather than assuming the suffix.
   */
  backupPath?: string;
  executable: boolean;
  newContent: string;
  path: string;
  status: UpdateFileStatus;
}

export interface UpdatePlan {
  entries: UpdatePlanEntry[];
  state: ScaffoldState;
  stateFile: GeneratedFile;
}

export const readScaffoldState = async (targetDirectory: string): Promise<ScaffoldState> => {
  const statePath = join(resolve(targetDirectory), stateFileName);
  const raw = await readStateFileContent(statePath, targetDirectory);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new Error(`Could not parse ${statePath} as JSON.`);
  }

  const result = scaffoldStateSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new Error(
      `Invalid ${stateFileName} in ${targetDirectory}: ${result.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  return result.data;
};

const readStateFileContent = async (
  statePath: string,
  targetDirectory: string,
): Promise<string> => {
  try {
    return await readFile(statePath, "utf8");
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }

    throw new Error(
      `No ${stateFileName} found in ${targetDirectory}. ` +
        `The update command only works in projects whose scaffold wrote ${stateFileName}.`,
    );
  }
};

/**
 * Re-render templates for a previously scaffolded project and classify every
 * generated file against what is on disk:
 *
 * - `up-to-date`: disk already matches the newly rendered content
 * - `update`: disk matches the hash recorded at scaffold time, so the file is
 *   unmodified by the user and safe to overwrite with new content
 * - `create`: the file does not exist on disk
 * - `skip-modified`: the user changed the file since scaffolding; it is only
 *   overwritten with `--force`
 */
export const planUpdate = async (
  targetDirectory: string,
  state: ScaffoldState,
): Promise<UpdatePlan> => {
  const renderedFiles = buildProjectFiles(state.config);
  const stateFile = renderedFiles.find((file) => file.path === stateFileName);
  if (stateFile === undefined) {
    throw new Error(`Rendered project files unexpectedly omit ${stateFileName}.`);
  }

  const entries: UpdatePlanEntry[] = [];
  for (const file of renderedFiles) {
    if (file.path === stateFileName) {
      continue;
    }

    entries.push({
      executable: file.executable === true,
      newContent: file.content,
      path: file.path,
      status: await classifyFile(targetDirectory, state, file),
    });
  }

  return { entries, state, stateFile };
};

const classifyFile = async (
  targetDirectory: string,
  state: ScaffoldState,
  file: GeneratedFile,
): Promise<UpdateFileStatus> => {
  let diskContent: string;
  try {
    diskContent = await readFile(join(resolve(targetDirectory), file.path), "utf8");
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }

    return "create";
  }

  if (diskContent === file.content) {
    return "up-to-date";
  }

  return hashFileContent(diskContent) === state.files[file.path] ? "update" : "skip-modified";
};

/**
 * Copies the current contents aside, returning the path used or undefined when
 * there was nothing to back up. Writes exclusively and steps to `.orig.1`,
 * `.orig.2`, ... when a name is taken: a second forced update would otherwise
 * overwrite the backup taken by the first, destroying the very work the backup
 * exists to protect.
 */
const backupExistingFile = async (fullPath: string): Promise<string | undefined> => {
  let existingContent: string;
  try {
    existingContent = await readFile(fullPath, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return undefined;
    }

    throw error;
  }

  for (let attempt = 0; attempt <= maximumBackupAttempts; attempt += 1) {
    const backupPath = `${fullPath}${backupFileSuffix}${attempt === 0 ? "" : `.${attempt}`}`;
    try {
      // "wx" fails rather than truncating, so an existing backup survives even
      // if it appears between the check and the write.
      await writeFile(backupPath, existingContent, { encoding: "utf8", flag: "wx" });
      return backupPath;
    } catch (error) {
      if (!isErrorWithCode(error, "EEXIST")) {
        throw error;
      }
    }
  }

  throw new Error(
    `Could not back up ${fullPath}: ${maximumBackupAttempts + 1} backup paths are already taken. ` +
      "Remove the stale backups or pass --no-backup.",
  );
};

/** Bounds the `.orig.N` search so a directory of stale backups cannot spin. */
const maximumBackupAttempts = 100;

export interface ApplyUpdateOptions {
  /** Write a `<path>.orig` copy before overwriting a user-modified file. */
  backup?: boolean;
  force?: boolean;
  /** Restrict the write to these paths; omit to write every writable entry. */
  only?: readonly string[];
}

/** Suffix for the copy kept when `--force` overwrites a file you changed. */
export const backupFileSuffix = ".orig";

const writableStatuses = (force: boolean): Set<UpdateFileStatus> =>
  force ? new Set(["create", "skip-modified", "update"]) : new Set(["create", "update"]);

export const applyUpdatePlan = async (
  targetDirectory: string,
  plan: UpdatePlan,
  options: ApplyUpdateOptions = {},
): Promise<UpdatePlanEntry[]> => {
  const resolvedTarget = resolve(targetDirectory);
  const statuses = writableStatuses(options.force === true);
  const selectedPaths = options.only === undefined ? undefined : new Set(options.only);
  const written: UpdatePlanEntry[] = [];

  for (const entry of plan.entries) {
    if (!statuses.has(entry.status) || selectedPaths?.has(entry.path) === false) {
      continue;
    }

    const fullPath = join(resolvedTarget, entry.path);
    // Only `skip-modified` entries hold work worth preserving: `update` matches
    // the hash recorded at scaffold time and `create` does not exist on disk.
    const absoluteBackupPath =
      entry.status === "skip-modified" && options.backup !== false
        ? await backupExistingFile(fullPath)
        : undefined;
    const backupPath =
      absoluteBackupPath === undefined ? undefined : relative(resolvedTarget, absoluteBackupPath);

    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, entry.newContent, "utf8");
    if (entry.executable) {
      await chmod(fullPath, 0o755);
    }

    written.push(backupPath === undefined ? entry : { ...entry, backupPath });
  }

  const statePath = join(resolvedTarget, plan.stateFile.path);
  const writtenPaths = new Set(written.map((entry) => entry.path));
  await writeFile(statePath, mergeStateFileContent(plan, writtenPaths), "utf8");

  return written;
};

/**
 * The state file records what is on disk, so a partial apply must keep the
 * previously recorded hash for every file it did not write. Writing the freshly
 * rendered hashes wholesale would describe content that never landed, and the
 * next `planUpdate` would read the mismatch as a user edit and demand `--force`
 * for files nobody touched.
 *
 * `up-to-date` entries take the rendered hash despite never being written: disk
 * already matches the new render, and preserving their stale hash would produce
 * the same misclassification one release later.
 */
const mergeStateFileContent = (plan: UpdatePlan, writtenPaths: ReadonlySet<string>): string => {
  // Re-reading what this process just rendered, so the shape is known; parsing
  // through Zod here would reorder the config keys against a fresh scaffold.
  const renderedState = JSON.parse(plan.stateFile.content) as ScaffoldState;

  for (const entry of plan.entries) {
    if (writtenPaths.has(entry.path) || entry.status === "up-to-date") {
      continue;
    }

    const previousHash = plan.state.files[entry.path];
    if (previousHash === undefined) {
      // Never scaffolded and not written now: recording a hash for a file that
      // is not on disk would be a claim about nothing.
      delete renderedState.files[entry.path];
    } else {
      renderedState.files[entry.path] = previousHash;
    }
  }

  return `${JSON.stringify(renderedState, null, 2)}\n`;
};
