import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { createDb, type Sql } from "./db.ts";
import { BOOT_LOCK } from "./migrate.ts";

/**
 * Seed from docs/PLAN.md §1.3: users, the container tree, grants and scoped statuses.
 * Fields and tasks join in phase 3.
 * Idempotent: it does nothing when users already exist.
 */
export async function seed(sql: Sql): Promise<boolean> {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${BOOT_LOCK})`;
    const [{ count }] = await tx<{ count: number }[]>`select count(*)::int as count from users`;
    if (count > 0) return false;

    const users = await tx<{ id: string; handle: string }[]>`
      insert into users (handle, name, role) values
        ('alice', 'Alice Admin', 'admin'),
        ('bob', 'Bob Builder', 'member'),
        ('carol', 'Carol Chen', 'member')
      returning id, handle`;
    const user = Object.fromEntries(users.map((u) => [u.handle, u.id]));

    const add = async (
      type: string,
      parentId: string | null,
      name: string,
      position: string,
      isPrivate = false,
    ) => {
      const [row] = await tx<{ id: string }[]>`
        insert into containers (type, parent_id, name, position, is_private)
        values (${type}, ${parentId}, ${name}, ${position}, ${isPrivate})
        returning id`;
      return row.id;
    };
    const [p0, p1] = generateNKeysBetween(null, null, 2);

    const workspace = await add("workspace", null, "Flowboard", p0);
    const engineering = await add("space", workspace, "Engineering", p0);
    const leadership = await add("space", workspace, "Leadership", p1, true);
    const q2 = await add("folder", engineering, "Q2 Launch", p0);
    const hiring = await add("folder", leadership, "Hiring", p0);
    const backlog = await add("list", q2, "Backlog", p0); // List A
    const sprint = await add("list", q2, "Sprint", p1); // List B
    await add("list", hiring, "Pipeline", p0); // List C

    await tx`
      insert into grants (container_id, user_id, mode) values
        (${sprint}, ${user.bob}, 'deny'),
        (${leadership}, ${user.carol}, 'allow')`;

    // Statuses: merge by key. Positions share one key space across levels.
    const [todo, doing, done] = generateNKeysBetween(null, null, 3);
    const review = generateKeyBetween(doing, done);
    const blocked = generateKeyBetween(review, done);
    const status = (
      owner: string,
      key: string,
      name: string,
      category: string,
      color: string,
      position: string,
    ) =>
      tx`insert into statuses (owner_id, key, name, category, color, position)
         values (${owner}, ${key}, ${name}, ${category}, ${color}, ${position})`;

    await status(workspace, "todo", "To do", "not_started", "#94a3b8", todo);
    await status(workspace, "in_progress", "In progress", "active", "#3b82f6", doing);
    await status(workspace, "done", "Done", "done", "#22c55e", done);
    await status(engineering, "in_review", "In review", "active", "#a855f7", review); // add
    await status(q2, "done", "Shipped", "done", "#16a34a", done); // override
    await tx`insert into statuses (owner_id, key, hidden) values (${backlog}, 'in_review', true)`; // hide
    await status(sprint, "blocked", "Blocked", "active", "#ef4444", blocked); // add
    return true;
  });
}

if (import.meta.main) {
  const sql = createDb();
  console.log((await seed(sql)) ? "Seeded." : "Seed skipped: data already exists.");
  await sql.end();
}
