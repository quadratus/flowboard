import type { Tx } from "../db.ts";

/**
 * Serializes all config writes, so two admins cannot each pass a check that their combined
 * changes break. Config writes are rare, so one lock for the workspace costs little.
 */
export async function lockConfig(tx: Tx) {
  await tx`select id from containers where type = 'workspace' for update`;
}

/**
 * Task writes take the same row lock in shared mode: many task writes run together, but never
 * at the same time as a config write. So a task cannot get a status that a parallel hide removes.
 */
export async function lockForTaskWrite(tx: Tx) {
  await tx`select id from containers where type = 'workspace' for share`;
}
