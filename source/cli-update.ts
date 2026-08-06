import { resolve } from "node:path";
import process from "node:process";

import { cyan, green, yellow } from "yoctocolors";

import type { CliArguments, WarningSink } from "./cli-helpers.js";
import { getPackageManagerRunPrefix } from "./cli-output.js";
import { loadPromptModule } from "./prompts.js";
import {
  applyUpdatePlan,
  type OrphanedFile,
  type OrphanRemovalResult,
  type OrphanStatus,
  planUpdate,
  readScaffoldState,
  type UpdateFileStatus,
  type UpdatePlan,
  type UpdatePlanEntry,
} from "./update.js";

const statusLabels = {
  create: "create ",
  "skip-modified": "skip   ",
  "up-to-date": "ok     ",
  update: "update ",
} satisfies Record<UpdateFileStatus, string>;

/**
 * Seven characters, matching `statusLabels`, so both lists share one column.
 * `orphan-gone` is absent deliberately: it is bookkeeping with nothing for the
 * user to decide, and `Exclude` keeps this table exhaustive over exactly the
 * statuses that get printed.
 */
const orphanStatusLabels = {
  "orphan-external": "outside",
  "orphan-modified": "keep   ",
  "orphan-unmodified": "remove ",
} satisfies Record<Exclude<OrphanStatus, "orphan-gone">, string>;

const isPrintableOrphan = (
  orphan: OrphanedFile,
): orphan is OrphanedFile & { status: Exclude<OrphanStatus, "orphan-gone"> } =>
  orphan.status !== "orphan-gone";

const countOrphans = (plan: UpdatePlan, status: OrphanStatus): number =>
  plan.orphans.filter((orphan) => orphan.status === status).length;

export const runUpdateWorkflow = async (
  cliArguments: CliArguments,
  warn: WarningSink,
): Promise<void> => {
  const targetDirectory = resolve(cliArguments.directoryArgument ?? ".");
  const state = await readScaffoldState(targetDirectory);
  const plan = await planUpdate(targetDirectory, state);

  process.stdout.write(
    `${cyan("Update plan")} for ${state.config.projectName} (scaffolded with v${state.version})\n`,
  );
  const removeOrphans = cliArguments.force && cliArguments.removeOrphans === true;
  printUpdatePlan(plan, cliArguments.force, removeOrphans);

  const pendingEntries = plan.entries.filter((entry) =>
    cliArguments.force
      ? entry.status !== "up-to-date"
      : entry.status === "create" || entry.status === "update",
  );
  // A positive filter, unlike `pendingEntries` above: removal is opted into,
  // never inherited from a broader flag.
  const pendingOrphans = removeOrphans
    ? plan.orphans.filter((orphan) => orphan.status === "orphan-unmodified")
    : [];

  if (cliArguments.dryRun) {
    printDryRunSummary(pendingEntries.length, pendingOrphans.length);
    return;
  }

  if (pendingEntries.length === 0 && pendingOrphans.length === 0) {
    printNothingToApply(plan);
    return;
  }

  let selectedPaths: string[] | undefined;
  if (!cliArguments.yes) {
    selectedPaths = await promptForEntriesToApply(pendingEntries, pendingOrphans, warn);

    if (selectedPaths === undefined) {
      process.stdout.write(`${cyan("info")} Update cancelled; no files were written.\n`);
      return;
    }

    if (selectedPaths.length === 0) {
      process.stdout.write(`${cyan("info")} No files selected; nothing was written.\n`);
      return;
    }
  }

  const orphanResults: OrphanRemovalResult[] = [];
  const written = await applyUpdatePlan(targetDirectory, plan, {
    backup: cliArguments.backup !== false,
    force: cliArguments.force,
    onOrphan: (result) => {
      orphanResults.push(result);
    },
    removeOrphans,
    ...(selectedPaths === undefined ? {} : { only: selectedPaths }),
  });
  process.stdout.write(`${green("done")} Updated ${written.length} file(s).\n`);
  printOrphanResults(orphanResults);

  // Report the path `applyUpdatePlan` actually used: a taken `.orig` pushes the
  // backup to `.orig.1`, and naming the wrong file is worse than naming none.
  const backupPaths = written
    .map((entry) => entry.backupPath)
    .filter((backupPath) => backupPath !== undefined);
  if (backupPaths.length > 0) {
    process.stdout.write(
      `${cyan("info")} Your previous contents were kept as ${backupPaths.join(", ")}.\n`,
    );
  }

  if (written.some((entry) => entry.path === "package.json")) {
    const runPrefix = getPackageManagerRunPrefix(state.config.packageManager);
    process.stdout.write(
      `${cyan("info")} package.json changed; run ${state.config.packageManager} install and ${runPrefix} check.\n`,
    );
  }
};

type ApplyDecision = "all" | "cancel" | "choose";

/**
 * Returns the paths to write, an empty array when nothing was selected, or
 * undefined when the user cancelled.
 */
const promptForEntriesToApply = async (
  pendingEntries: UpdatePlanEntry[],
  pendingOrphans: OrphanedFile[],
  warn: WarningSink,
): Promise<string[] | undefined> => {
  const promptModule = await loadPromptModule(warn);
  const decision = await promptModule.select<ApplyDecision>({
    choices: [
      {
        name:
          pendingOrphans.length === 0
            ? `Apply all ${pendingEntries.length} file(s)`
            : `Apply all ${pendingEntries.length} file(s) and remove ${pendingOrphans.length} file(s)`,
        value: "all",
      },
      { name: "Choose files…", value: "choose" },
      { name: "Cancel", value: "cancel" },
    ],
    default: "all",
    message: "Apply these updates?",
  });

  if (decision === "cancel") {
    return undefined;
  }

  if (decision === "all") {
    return [...pendingEntries.map((entry) => entry.path), ...pendingOrphans.map((o) => o.path)];
  }

  // Entry paths and orphan paths are disjoint by construction -- an orphan is a
  // path the render did not produce -- so one flat list of paths still works.
  return promptModule.checkbox<string>({
    choices: [
      ...pendingEntries.map((entry) => ({
        checked: true,
        name: `${statusLabels[entry.status].trim()} ${entry.path}`,
        value: entry.path,
      })),
      ...pendingOrphans.map((orphan) => ({
        // Unchecked: "Choose files…" is the deliberate path, and a delete should
        // cost a keystroke that a rewrite does not. "Apply all" already covers
        // anyone who means it.
        checked: false,
        name: `remove ${orphan.path} (no longer generated)`,
        value: orphan.path,
      })),
    ],
    message:
      pendingOrphans.length === 0
        ? "Select the files to update"
        : "Select the files to update and remove",
  });
};

const printDryRunSummary = (pendingCount: number, removalCount: number): void => {
  // The no-removal wording is byte-identical to what this printed before
  // removals existed, so anything asserting on it keeps working.
  const clauses = [
    `${pendingCount} file(s) would be written`,
    ...(removalCount > 0 ? [`${removalCount} file(s) would be removed`] : []),
  ];
  process.stdout.write(`${cyan("info")} Dry run: ${clauses.join("; ")}.\n`);
};

const printNothingToApply = (plan: UpdatePlan): void => {
  const skippedCount = plan.entries.filter((entry) => entry.status === "skip-modified").length;
  const removableCount = countOrphans(plan, "orphan-unmodified");
  const notes = [
    ...(skippedCount > 0 ? [`${skippedCount} modified file(s) were skipped`] : []),
    ...(removableCount > 0
      ? [`${removableCount} file(s) are no longer generated but were left in place`]
      : []),
  ];

  process.stdout.write(
    notes.length > 0
      ? `${green("done")} No safe updates to apply; ${notes.join(" and ")}.\n`
      : `${green("done")} Everything is up to date.\n`,
  );
};

const printOrphanResults = (results: OrphanRemovalResult[]): void => {
  const removedPaths = results
    .filter((result) => result.outcome === "removed")
    .map((result) => result.path);
  if (removedPaths.length > 0) {
    process.stdout.write(
      `${green("done")} Removed ${removedPaths.length} no-longer-generated file(s): ${removedPaths.join(", ")}.\n`,
    );
  }

  const changedPaths = results
    .filter((result) => result.outcome === "skipped-changed")
    .map((result) => result.path);
  if (changedPaths.length > 0) {
    process.stdout.write(
      `${yellow("warning")} ${changedPaths.length} file(s) changed after the plan was made and were not removed: ${changedPaths.join(", ")}.\n`,
    );
  }
};

const printUpdatePlan = (plan: UpdatePlan, force: boolean, removeOrphans: boolean): void => {
  for (const entry of plan.entries) {
    process.stdout.write(`  ${statusLabels[entry.status]} ${entry.path}\n`);
  }

  const printableOrphans = plan.orphans.filter(isPrintableOrphan);
  if (printableOrphans.length > 0) {
    process.stdout.write("\nNo longer generated by these templates:\n");
    for (const orphan of printableOrphans) {
      process.stdout.write(`  ${orphanStatusLabels[orphan.status]} ${orphan.path}\n`);
    }
  }

  const modifiedCount = plan.entries.filter((entry) => entry.status === "skip-modified").length;
  if (modifiedCount > 0 && !force) {
    process.stdout.write(
      `${yellow("warning")} ${modifiedCount} file(s) were modified after scaffolding and will be skipped; pass --force to overwrite them.\n`,
    );
  }

  printOrphanNotes(plan, removeOrphans);
  process.stdout.write("\n");
};

const printOrphanNotes = (plan: UpdatePlan, removeOrphans: boolean): void => {
  const removableCount = countOrphans(plan, "orphan-unmodified");
  if (removableCount > 0 && !removeOrphans) {
    // The one place the config-toggle false positive can be raised before the
    // destructive flags are typed.
    process.stdout.write(
      `${cyan("info")} ${removableCount} file(s) are recorded but no longer generated; pass --force --remove-orphans to delete them. Check your recorded config first — flipping lintFormatTooling, bundler, or workspaceMode makes wanted files look unwanted.\n`,
    );
  }

  const keptCount = countOrphans(plan, "orphan-modified");
  if (keptCount > 0) {
    process.stdout.write(
      `${yellow("warning")} ${keptCount} no-longer-generated file(s) were modified after scaffolding and are never removed automatically.\n`,
    );
  }

  const externalCount = countOrphans(plan, "orphan-external");
  if (externalCount > 0) {
    process.stdout.write(
      `${yellow("warning")} ${externalCount} path(s) recorded in the state file point outside this project and were ignored. Inspect that file.\n`,
    );
  }
};
