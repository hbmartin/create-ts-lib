export type { LintFormatTooling } from "./lint-format-tooling.js";
export type { NodeTarget } from "./node-target.js";
export type { ScaffoldOptions, ScaffoldProgress } from "./scaffold.js";
export { scaffoldProject } from "./scaffold.js";
export type {
  Bundler,
  GeneratedFile,
  LicenseName,
  PackageManager,
  ScaffoldConfig,
  ScaffoldConfigOverrides,
} from "./templates/files.js";
export { buildProjectFiles, defaultScaffoldConfig } from "./templates/files.js";
export type { ScaffoldState } from "./templates/state.js";
export type {
  OrphanedFile,
  OrphanStatus,
  UpdateFileStatus,
  UpdatePlan,
  UpdatePlanEntry,
} from "./update.js";
export { applyUpdatePlan, planUpdate, readScaffoldState } from "./update.js";
