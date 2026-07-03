import { resolve } from "node:path";
import process from "node:process";

import { cyan, green, yellow } from "yoctocolors";

import type { CliArguments, WarningSink } from "./cli-helpers.js";
import { getPackageManagerRunPrefix } from "./cli-output.js";
import { loadPromptModule } from "./prompts.js";
import {
  applyUpdatePlan,
  planUpdate,
  readScaffoldState,
  type UpdateFileStatus,
  type UpdatePlan,
} from "./update.js";

const statusLabels = {
  create: "create ",
  "skip-modified": "skip   ",
  "up-to-date": "ok     ",
  update: "update ",
} satisfies Record<UpdateFileStatus, string>;

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
  printUpdatePlan(plan, cliArguments.force);

  const pendingEntries = plan.entries.filter((entry) =>
    cliArguments.force
      ? entry.status !== "up-to-date"
      : entry.status === "create" || entry.status === "update",
  );

  if (cliArguments.dryRun) {
    process.stdout.write(
      `${cyan("info")} Dry run: ${pendingEntries.length} file(s) would be written.\n`,
    );
    return;
  }

  if (pendingEntries.length === 0) {
    const skippedCount = plan.entries.filter((entry) => entry.status === "skip-modified").length;
    process.stdout.write(
      skippedCount > 0
        ? `${green("done")} No safe updates to apply; ${skippedCount} modified file(s) were skipped.\n`
        : `${green("done")} Everything is up to date.\n`,
    );
    return;
  }

  if (!cliArguments.yes) {
    const promptModule = await loadPromptModule(warn);
    const confirmed = await promptModule.confirm({
      default: true,
      message: `Apply ${pendingEntries.length} file update(s)?`,
    });

    if (!confirmed) {
      process.stdout.write(`${cyan("info")} Update cancelled; no files were written.\n`);
      return;
    }
  }

  const written = await applyUpdatePlan(targetDirectory, plan, {
    force: cliArguments.force,
  });
  process.stdout.write(`${green("done")} Updated ${written.length} file(s).\n`);

  if (written.some((entry) => entry.path === "package.json")) {
    const runPrefix = getPackageManagerRunPrefix(state.config.packageManager);
    process.stdout.write(
      `${cyan("info")} package.json changed; run ${state.config.packageManager} install and ${runPrefix} check.\n`,
    );
  }
};

const printUpdatePlan = (plan: UpdatePlan, force: boolean): void => {
  for (const entry of plan.entries) {
    process.stdout.write(`  ${statusLabels[entry.status]} ${entry.path}\n`);
  }

  const modifiedCount = plan.entries.filter((entry) => entry.status === "skip-modified").length;
  if (modifiedCount > 0 && !force) {
    process.stdout.write(
      `${yellow("warning")} ${modifiedCount} file(s) were modified after scaffolding and will be skipped; pass --force to overwrite them.\n`,
    );
  }
  process.stdout.write("\n");
};
