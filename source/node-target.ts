import { z } from "zod";

/**
 * The Node major a generated project targets. It fixes `engines.node`, the
 * `@types/node` major, and the CI matrix together, because those three are one
 * decision wearing three hats: types that describe a newer runtime than
 * `engines.node` promises let a project typecheck against APIs it told its
 * users it can run without.
 *
 * Only even majors are offered. Odd lines (25, 27) reach end-of-life months
 * after release and never become LTS, while an `engines.node` floor is a
 * promise a published package keeps for far longer than that.
 */
export const nodeTargetSchema = z.enum(["24", "26"]);

export type NodeTarget = z.infer<typeof nodeTargetSchema>;

export const defaultNodeTarget = "24" satisfies NodeTarget;

/**
 * Ascending, and `ciNodeVersions` depends on that ordering.
 * `test/scaffold.test.ts` asserts it rather than leaving it to convention.
 */
export const nodeTargetOptions = nodeTargetSchema.options;

export const nodeEnginesRange = (nodeTarget: NodeTarget): string => `>=${nodeTarget}`;

/**
 * Floor plus next major: a project is tested on the major it declares and on
 * the one after it, so it hears about the next LTS from its own CI rather than
 * from a user's bug report. A project already on the newest known target has no
 * next major, so its matrix is a single leg -- testing it on an older major
 * would contradict the `engines.node` it ships.
 */
export const ciNodeVersions = (nodeTarget: NodeTarget): NodeTarget[] => {
  const floorIndex = nodeTargetOptions.indexOf(nodeTarget);

  // Deliberately a slice and not a `>=` filter: when a third target is added,
  // a filter would silently widen every matrix to floor-plus-all-later-majors.
  return nodeTargetOptions.slice(floorIndex, floorIndex + 2);
};
