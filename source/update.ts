import { chmod, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { isErrorWithCode, isFileNotFoundError } from "./filesystem-errors.js";
import { isInsideDirectory } from "./path-comparison.js";
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

/**
 * How a path the state file records but the templates no longer render relates
 * to what is on disk.
 *
 * Deliberately not part of `UpdateFileStatus`: an orphan has no rendered
 * content, so it cannot honour `UpdatePlanEntry.newContent`, and widening that
 * union would enrol orphans in every `status !== "up-to-date"` filter -- all of
 * which mean "pending work to write".
 */
export type OrphanStatus =
  | "orphan-external"
  | "orphan-gone"
  | "orphan-modified"
  | "orphan-unmodified";

export interface OrphanedFile {
  path: string;
  status: OrphanStatus;
}

export interface UpdatePlan {
  entries: UpdatePlanEntry[];
  /** Paths recorded in the state file that the current config no longer renders. */
  orphans: OrphanedFile[];
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
 *
 * Paths the state file records but the render no longer produces come back
 * separately as `orphans`.
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

  // Includes the state file itself, so `.create-ts-lib.json` can never be
  // classified as an orphan: `update` must not be able to delete the record it
  // reads on the next run.
  const renderedPaths = new Set(renderedFiles.map((file) => file.path));

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

  return {
    entries,
    orphans: await buildOrphans(targetDirectory, state, renderedPaths),
    state,
    stateFile,
  };
};

const buildOrphans = async (
  targetDirectory: string,
  state: ScaffoldState,
  renderedPaths: ReadonlySet<string>,
): Promise<OrphanedFile[]> => {
  const resolvedTarget = resolve(targetDirectory);
  const orphans: OrphanedFile[] = [];

  // Insertion order rather than sorted: the state file's key order is the render
  // order of whichever release wrote it, which groups related files far better
  // than lexicographic order would.
  for (const [path, recordedHash] of Object.entries(state.files)) {
    if (renderedPaths.has(path)) {
      continue;
    }

    orphans.push({ path, status: await classifyOrphan(resolvedTarget, path, recordedHash) });
  }

  return orphans;
};

/**
 * Where the file `fullPath` names really lies once symlinks are followed.
 *
 * `resolve` and `isInsideDirectory` are lexical: a recorded key such as
 * `linked-directory/file` passes containment while `linked-directory` is a
 * symlink pointing outside the project, so the read and the delete would land
 * on the external target. `realpath` on both sides puts the comparison in the
 * same namespace (on macOS the target itself usually sits behind `/var` ->
 * `/private/var`).
 */
const locateOrphanOnDisk = async (
  resolvedTarget: string,
  fullPath: string,
): Promise<"external" | "inside" | "missing" | "unreadable"> => {
  let realFullPath: string;
  try {
    realFullPath = await realpath(fullPath);
  } catch (error) {
    return isFileNotFoundError(error) ? "missing" : "unreadable";
  }

  return isInsideDirectory(await realpath(resolvedTarget), realFullPath) ? "inside" : "external";
};

const classifyOrphan = async (
  resolvedTarget: string,
  path: string,
  recordedHash: string,
): Promise<OrphanStatus> => {
  const fullPath = resolve(resolvedTarget, path);
  // `.create-ts-lib.json` is user-editable and its keys are unvalidated strings.
  // This is the first place one becomes a path that something may delete, so
  // where it lands is checked rather than assumed.
  if (!isInsideDirectory(resolvedTarget, fullPath)) {
    return "orphan-external";
  }

  const location = await locateOrphanOnDisk(resolvedTarget, fullPath);
  if (location === "external") {
    return "orphan-external";
  }
  if (location === "missing") {
    return "orphan-gone";
  }
  if (location === "unreadable") {
    // Same fail-safe as the unreadable-content branch below: never removed, and
    // not allowed to block every future update.
    return "orphan-modified";
  }

  let diskContent: string;
  try {
    diskContent = await readFile(fullPath, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return "orphan-gone";
    }

    // Unlike `classifyFile`, an unreadable path is not rethrown. There,
    // misclassifying as `create` would overwrite it; here the fail-safe answer
    // never removes anything, and throwing would let one unreadable leftover
    // block every update the project will ever run.
    return "orphan-modified";
  }

  return hashFileContent(diskContent) === recordedHash ? "orphan-unmodified" : "orphan-modified";
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

export interface OrphanRemovalResult {
  /**
   * `removed` — deleted.
   * `skipped-changed` — the contents changed between the plan and the delete.
   * `skipped-external` — the recorded path escapes the target directory.
   * `skipped-missing` — already gone; the goal state held either way.
   */
  outcome: "removed" | "skipped-changed" | "skipped-external" | "skipped-missing";
  path: string;
}

export interface ApplyUpdateOptions {
  /** Write a `<path>.orig` copy before overwriting a user-modified file. */
  backup?: boolean;
  force?: boolean;
  /**
   * Called once per orphan this run tried to remove. A callback rather than a
   * second return value: `applyUpdatePlan` is public API, and the TOCTOU check
   * means "requested" and "removed" differ by construction, so the caller
   * cannot infer this from what it asked for.
   */
  onOrphan?: (result: OrphanRemovalResult) => void;
  /** Restrict writes *and* removals to these paths; omit for every eligible one. */
  only?: readonly string[];
  /** Delete unmodified orphans. Ignored unless `force` is also true. */
  removeOrphans?: boolean;
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

  // Writes first, so a failing write aborts before anything is destroyed.
  const clearedOrphanPaths = await clearOrphans(resolvedTarget, plan, options, selectedPaths);

  const statePath = join(resolvedTarget, plan.stateFile.path);
  const writtenPaths = new Set(written.map((entry) => entry.path));
  await writeFile(statePath, mergeStateFileContent(plan, writtenPaths, clearedOrphanPaths), "utf8");

  return written;
};

/**
 * Removes the orphans this run is allowed to, and returns every path whose key
 * should leave the state file.
 *
 * Two independent opt-ins, because `--force` means "overwrite my edits", which
 * is not the same permission as "delete files a config toggle turned off" -- and
 * `--yes --force` is a documented, scripted combination that is non-destructive
 * today.
 */
const clearOrphans = async (
  resolvedTarget: string,
  plan: UpdatePlan,
  options: ApplyUpdateOptions,
  selectedPaths: ReadonlySet<string> | undefined,
): Promise<ReadonlySet<string>> => {
  // Seeded with no flag gate: an `orphan-gone` key is a claim about a file
  // nobody can find, nothing is deleted to establish that, and without it a file
  // the user removed by hand is re-reported on every run for the life of the
  // project.
  const cleared = new Set(
    plan.orphans.filter((orphan) => orphan.status === "orphan-gone").map((orphan) => orphan.path),
  );

  if (options.force !== true || options.removeOrphans !== true) {
    return cleared;
  }

  for (const orphan of plan.orphans) {
    if (orphan.status !== "orphan-unmodified" || selectedPaths?.has(orphan.path) === false) {
      continue;
    }

    const recordedHash = plan.state.files[orphan.path];
    if (recordedHash === undefined) {
      continue;
    }

    const outcome = await removeUnmodifiedOrphan(resolvedTarget, orphan.path, recordedHash);
    // `skipped-missing` counts as cleared: the goal state holds, and
    // re-recording the key would make the next run rediscover it as gone.
    if (outcome === "removed" || outcome === "skipped-missing") {
      cleared.add(orphan.path);
    }

    options.onOrphan?.({ outcome, path: orphan.path });
  }

  return cleared;
};

const removeUnmodifiedOrphan = async (
  resolvedTarget: string,
  path: string,
  recordedHash: string,
): Promise<OrphanRemovalResult["outcome"]> => {
  const fullPath = resolve(resolvedTarget, path);
  // Re-checked rather than trusted from the plan: a programmatic caller can pass
  // any plan at all, and defence in depth on a delete is close to free.
  if (!isInsideDirectory(resolvedTarget, fullPath)) {
    return "skipped-external";
  }

  const location = await locateOrphanOnDisk(resolvedTarget, fullPath);
  if (location === "external") {
    return "skipped-external";
  }
  if (location === "missing") {
    return "skipped-missing";
  }
  if (location === "unreadable") {
    // Could not establish where the path really leads, so it is not removed.
    return "skipped-changed";
  }

  let diskContent: string;
  try {
    diskContent = await readFile(fullPath, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return "skipped-missing";
    }

    // Could not confirm it is untouched, so it is not removed.
    return "skipped-changed";
  }

  // The plan was built before the prompt and an editor can save in between. A
  // stale hash here means user work now exists that no backup was taken for,
  // because the "nothing to lose" premise for skipping the backup just expired.
  if (hashFileContent(diskContent) !== recordedHash) {
    return "skipped-changed";
  }

  // `force` so a concurrent delete counts as success rather than ENOENT: the
  // goal state is that this file is gone, and it is.
  await rm(fullPath, { force: true });

  return "removed";
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
const mergeStateFileContent = (
  plan: UpdatePlan,
  writtenPaths: ReadonlySet<string>,
  clearedOrphanPaths: ReadonlySet<string>,
): string => {
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

  // The rendered map cannot contain an orphan -- being absent from the render is
  // what makes it one -- so a survivor has to be *added back*, not merely left
  // alone. The loop above only ever overwrites or deletes keys that are already
  // there, which is why every apply used to erase the record silently. Dropping
  // it loses the one hash that proves the file is untouched, and no later run
  // could tell it apart from something the user wrote by hand.
  for (const orphan of plan.orphans) {
    const previousHash = plan.state.files[orphan.path];
    if (clearedOrphanPaths.has(orphan.path) || previousHash === undefined) {
      continue;
    }

    renderedState.files[orphan.path] = previousHash;
  }

  return `${JSON.stringify(renderedState, null, 2)}\n`;
};
