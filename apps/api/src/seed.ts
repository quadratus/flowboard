import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { createDb, type Sql } from "./db.ts";
import { BOOT_LOCK } from "./migrate.ts";

/**
 * Seed from docs/PLAN.md §1.3: users, the container tree, grants, scoped statuses,
 * custom fields on 3 levels and 21 tasks.
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
    const pipeline = await add("list", hiring, "Pipeline", p0); // List C

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

    // Custom fields: 6 definitions on space, folder and list levels.
    const f = generateNKeysBetween(null, null, 6);
    const field = (
      owner: string,
      key: string,
      name: string,
      type: string,
      required: boolean,
      position: string,
      options?: object[],
    ) =>
      tx`insert into field_definitions (owner_id, key, name, type, required, options, position)
         values (${owner}, ${key}, ${name}, ${type}, ${required}, ${options ? tx.json(options as never) : null}, ${position})`;

    await field(engineering, "estimate", "Estimate (points)", "number", true, f[0]);
    await field(engineering, "team", "Team", "single_select", false, f[1], [
      { id: "web", label: "Web", color: "#0ea5e9" },
      { id: "api", label: "API", color: "#f97316" },
      { id: "infra", label: "Infra", color: "#64748b" },
    ]);
    await field(q2, "labels", "Labels", "multi_select", false, f[2], [
      { id: "bug", label: "Bug", color: "#ef4444" },
      { id: "feature", label: "Feature", color: "#22c55e" },
      { id: "chore", label: "Chore", color: "#a3a3a3" },
    ]);
    await field(sprint, "review_date", "Review date", "date", false, f[3]);
    await field(leadership, "stage", "Stage", "single_select", true, f[4], [
      { id: "screen", label: "Screen" },
      { id: "onsite", label: "Onsite" },
      { id: "offer", label: "Offer" },
    ]);
    await field(leadership, "remote", "Remote", "checkbox", false, f[5]);

    // Tasks: [list, status, title, priority, due (days from now), assignees, custom fields]
    type Seed = [string, string, string, string, number | null, string[], object];
    const day = 86_400_000;
    const tasks: Seed[] = [
      [
        backlog,
        "todo",
        "Sketch onboarding checklist",
        "normal",
        12,
        ["carol"],
        { estimate: 3, team: "web", labels: ["feature"] },
      ],
      [
        backlog,
        "todo",
        "Rate-limit the public API",
        "high",
        6,
        ["bob"],
        { estimate: 5, team: "api" },
      ],
      [
        backlog,
        "todo",
        "Audit unused feature flags",
        "low",
        null,
        [],
        { estimate: 2, labels: ["chore"] },
      ],
      [
        backlog,
        "todo",
        "Dark mode for the board",
        "none",
        30,
        ["carol"],
        { estimate: 8, team: "web", labels: ["feature"] },
      ],
      [
        backlog,
        "in_progress",
        "Fix flaky login test",
        "urgent",
        1,
        ["bob"],
        { estimate: 1, team: "web", labels: ["bug"] },
      ],
      [
        backlog,
        "in_progress",
        "Move images to the CDN",
        "normal",
        9,
        ["bob", "carol"],
        { estimate: 5, team: "infra" },
      ],
      [
        backlog,
        "done",
        "Upgrade Postgres to 18",
        "high",
        -3,
        ["alice"],
        { estimate: 3, team: "infra", labels: ["chore"] },
      ],
      [
        backlog,
        "done",
        "Write the API error guide",
        "low",
        -8,
        ["carol"],
        { estimate: 2, team: "api" },
      ],
      [
        sprint,
        "todo",
        "Billing page empty state",
        "normal",
        4,
        ["carol"],
        { estimate: 2, team: "web", labels: ["feature"] },
      ],
      [
        sprint,
        "todo",
        "Webhook retries with backoff",
        "high",
        5,
        ["alice"],
        { estimate: 5, team: "api" },
      ],
      [
        sprint,
        "in_progress",
        "Drag cards between columns",
        "urgent",
        2,
        ["carol"],
        { estimate: 8, team: "web", labels: ["feature"] },
      ],
      [
        sprint,
        "in_progress",
        "Cursor pagination for tasks",
        "high",
        3,
        ["alice"],
        { estimate: 3, team: "api" },
      ],
      [
        sprint,
        "in_review",
        "Status inheritance resolver",
        "high",
        1,
        ["alice", "carol"],
        { estimate: 5, team: "api", review_date: "2026-11-20" },
      ],
      [
        sprint,
        "in_review",
        "Keyboard focus on the board",
        "normal",
        2,
        ["carol"],
        { estimate: 2, team: "web", labels: ["bug"], review_date: "2026-11-19" },
      ],
      [
        sprint,
        "blocked",
        "SSO with the identity provider",
        "urgent",
        0,
        ["alice"],
        { estimate: 8, team: "infra" },
      ],
      [
        sprint,
        "done",
        "Seed script for demo data",
        "normal",
        -1,
        ["alice"],
        { estimate: 2, team: "api", labels: ["chore"] },
      ],
      [
        pipeline,
        "todo",
        "Staff engineer, platform",
        "high",
        14,
        ["alice"],
        { stage: "screen", remote: true },
      ],
      [pipeline, "todo", "Product designer", "normal", 21, ["carol"], { stage: "screen" }],
      [
        pipeline,
        "in_progress",
        "Senior frontend engineer",
        "urgent",
        3,
        ["alice", "carol"],
        { stage: "onsite", remote: true },
      ],
      [
        pipeline,
        "in_progress",
        "Engineering manager",
        "high",
        7,
        ["alice"],
        { stage: "onsite", remote: false },
      ],
      [
        pipeline,
        "done",
        "Backend engineer",
        "normal",
        -5,
        ["carol"],
        { stage: "offer", remote: true },
      ],
    ];
    const column = new Map<string, string | null>();
    for (const [list, statusKey, title, priority, due, assignees, values] of tasks) {
      const at = `${list}:${statusKey}`;
      const position = generateKeyBetween(column.get(at) ?? null, null);
      column.set(at, position);
      const [task] = await tx<{ id: string }[]>`
        insert into tasks (list_id, status_key, title, priority, due_date, custom_fields, position)
        values (${list}, ${statusKey}, ${title}, ${priority},
                ${due === null ? null : new Date(Date.now() + due * day)}, ${tx.json(values as never)}, ${position})
        returning id`;
      for (const handle of assignees) {
        await tx`insert into task_assignees (task_id, user_id) values (${task.id}, ${user[handle]})`;
      }
    }
    return true;
  });
}

if (import.meta.main) {
  const sql = createDb();
  console.log((await seed(sql)) ? "Seeded." : "Seed skipped: data already exists.");
  await sql.end();
}
