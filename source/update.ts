import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { isFileNotFoundError } from "./filesystem-errors.js";
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

const backupExistingFile = async (fullPath: string): Promise<void> => {
  let existingContent: string;
  try {
    existingContent = await readFile(fullPath, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return;
    }

    throw error;
  }

  await writeFile(`${fullPath}${backupFileSuffix}`, existingContent, "utf8");
};

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
    if (entry.status === "skip-modified" && options.backup !== false) {
      await backupExistingFile(fullPath);
    }

    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, entry.newContent, "utf8");
    if (entry.executable) {
      await chmod(fullPath, 0o755);
    }

    written.push(entry);
  }

  const statePath = join(resolvedTarget, plan.stateFile.path);
  await writeFile(statePath, plan.stateFile.content, "utf8");

  return written;
};
