import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import type { App } from "../src/app.ts";
import type { Sql } from "../src/db.ts";
import { call, freshApp } from "./helpers.ts";

let app: App;
let sql: Sql;
let ids: Record<string, string>;

beforeAll(async () => {
  ({ app, sql, ids } = await freshApp());
});
afterAll(async () => {
  await app.close();
  await sql.end();
});

const taskId = async (title: string) => {
  const [t] = await sql<{ id: string }[]>`select id from tasks where title = ${title}`;
  return t.id;
};
const create = (list: string, body: object, as = "alice") =>
  call(app, as, "POST", `/v1/lists/${ids[list]}/tasks`, body);
const paths = (res: { body: { error: { details: { path: string }[] } } }) =>
  res.body.error.details.map((d) => d.path);
const orphanCount = async () => (await sql`select * from orphan_tasks()`).length;

describe("permissions on tasks", () => {
  it("returns 403 when Bob reads a task in a denied list", async () => {
    const id = await taskId("Webhook retries with backoff"); // in Sprint, denied for Bob
    const res = await call(app, "bob", "GET", `/v1/tasks/${id}`);
    expect(res.status).toBe(403);
  });

  it("returns 403 when Bob lists the tasks of a denied list", async () => {
    expect((await call(app, "bob", "GET", `/v1/lists/${ids.Sprint}/tasks`)).status).toBe(403);
  });

  it("lets Bob read and edit tasks in a list he can see", async () => {
    const id = await taskId("Rate-limit the public API"); // in Backlog
    expect((await call(app, "bob", "GET", `/v1/tasks/${id}`)).status).toBe(200);
    const res = await call(app, "bob", "PATCH", `/v1/tasks/${id}`, { priority: "urgent" });
    expect(res.status).toBe(200);
    expect(res.body.priority).toBe("urgent");
  });

  it("returns 403 when Bob moves a task into a list he cannot see", async () => {
    const id = await taskId("Rate-limit the public API");
    const res = await call(app, "bob", "POST", `/v1/tasks/${id}/move`, { listId: ids.Sprint });
    expect(res.status).toBe(403);
  });
});

describe("status validation", () => {
  it("rejects create with an unknown status key", async () => {
    const res = await create("Backlog", {
      title: "X",
      statusKey: "nope",
      customFields: { estimate: 1 },
    });
    expect(res.status).toBe(400);
    expect(paths(res)).toEqual(["statusKey"]);
  });

  it("rejects a status that exists elsewhere but is hidden in this list", async () => {
    const res = await create("Backlog", {
      title: "X",
      statusKey: "in_review",
      customFields: { estimate: 1 },
    });
    expect(res.status).toBe(400);
    expect(paths(res)).toEqual(["statusKey"]);
  });

  it("rejects update with an unknown status key", async () => {
    const id = await taskId("Audit unused feature flags");
    const res = await call(app, "alice", "PATCH", `/v1/tasks/${id}`, { statusKey: "blocked" }); // Sprint only
    expect(res.status).toBe(400);
    expect(paths(res)).toEqual(["statusKey"]);
  });
});

describe("custom fields", () => {
  it("accepts a valid payload and stores option ids", async () => {
    const res = await create("Sprint", {
      title: "Valid task",
      statusKey: "blocked",
      priority: "high",
      assigneeIds: [ids.bob],
      customFields: {
        estimate: 3,
        team: "api",
        labels: ["bug", "chore"],
        review_date: "2026-12-01",
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.customFields).toEqual({
      estimate: 3,
      team: "api",
      labels: ["bug", "chore"],
      review_date: "2026-12-01",
    });
    expect(res.body.assigneeIds).toEqual([ids.bob]);
  });

  it("rejects a wrong type with the field path", async () => {
    const res = await create("Backlog", {
      title: "X",
      statusKey: "todo",
      customFields: { estimate: "five" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { path: "customFields.estimate", issue: "expected number, received string" },
    ]);
  });

  it("rejects a select value that is not an option", async () => {
    const res = await create("Backlog", {
      title: "X",
      statusKey: "todo",
      customFields: { estimate: 1, team: "design" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { path: "customFields.team", issue: "option 'design' does not exist" },
    ]);
  });

  it("rejects a field that the list does not have", async () => {
    // review_date belongs to Sprint, not to Backlog.
    const res = await create("Backlog", {
      title: "X",
      statusKey: "todo",
      customFields: { estimate: 1, review_date: "2026-12-01" },
    });
    expect(res.status).toBe(400);
    expect(paths(res)).toEqual(["customFields.review_date"]);
  });

  it("rejects create without a required field", async () => {
    const res = await create("Backlog", { title: "No estimate", statusKey: "todo" });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { path: "customFields.estimate", issue: "is required" },
    ]);
  });

  it("rejects an update that clears a required field", async () => {
    const id = await taskId("Audit unused feature flags");
    const res = await call(app, "alice", "PATCH", `/v1/tasks/${id}`, {
      customFields: { estimate: null },
    });
    expect(res.status).toBe(400);
    expect(paths(res)).toEqual(["customFields.estimate"]);
  });

  it("patches one field and keeps the others", async () => {
    const id = await taskId("Sketch onboarding checklist");
    const res = await call(app, "alice", "PATCH", `/v1/tasks/${id}`, {
      customFields: { estimate: 5, labels: null },
    });
    expect(res.status).toBe(200);
    expect(res.body.customFields).toEqual({ estimate: 5, team: "web" });
  });

  it("reports status and field issues together", async () => {
    const res = await create("Backlog", {
      title: "X",
      statusKey: "nope",
      customFields: { estimate: "1", team: "x" },
    });
    expect(paths(res).toSorted()).toEqual([
      "customFields.estimate",
      "customFields.team",
      "statusKey",
    ]);
  });
});

describe("cross-list move", () => {
  it("rejects a move into a list without the task's status when no statusKey is given", async () => {
    const id = await taskId("SSO with the identity provider"); // Sprint, status blocked
    const res = await call(app, "alice", "POST", `/v1/tasks/${id}/move`, { listId: ids.Backlog });
    expect(res.status).toBe(400);
    expect(paths(res)).toEqual(["statusKey"]);
    const [t] = await sql`select list_id, status_key from tasks where id = ${id}`;
    expect(t).toEqual({ listId: ids.Sprint, statusKey: "blocked" }); // unchanged
  });

  it("moves with an explicit statusKey and strips fields the destination does not define", async () => {
    const id = await taskId("Status inheritance resolver"); // has review_date (Sprint only)
    const res = await call(app, "alice", "POST", `/v1/tasks/${id}/move`, {
      listId: ids.Backlog,
      statusKey: "todo",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      listId: ids.Backlog,
      statusKey: "todo",
      strippedFields: ["review_date"],
    });
    expect(res.body.customFields).not.toHaveProperty("review_date");
  });

  it("keeps the status when the destination has the same key", async () => {
    const id = await taskId("Billing page empty state"); // Sprint, todo
    const res = await call(app, "alice", "POST", `/v1/tasks/${id}/move`, { listId: ids.Backlog });
    expect(res.status).toBe(200);
    expect(res.body.statusKey).toBe("todo");
  });

  it("requires values for required fields of the destination", async () => {
    // Pipeline (Leadership space) requires stage and has no estimate.
    const id = await taskId("Write the API error guide");
    const missing = await call(app, "alice", "POST", `/v1/tasks/${id}/move`, {
      listId: ids.Pipeline,
    });
    expect(missing.status).toBe(400);
    expect(paths(missing)).toEqual(["customFields.stage"]);

    const res = await call(app, "alice", "POST", `/v1/tasks/${id}/move`, {
      listId: ids.Pipeline,
      customFields: { stage: "screen" },
    });
    expect(res.status).toBe(200);
    expect(res.body.customFields).toEqual({ stage: "screen" });
    expect(res.body.strippedFields.toSorted()).toEqual(["estimate", "team"]);
  });
});

describe("config safety: no orphan board state", () => {
  it("rejects deleting a status that tasks use, and leaves no orphans", async () => {
    const [blocked] =
      await sql`select id from statuses where owner_id = ${ids.Sprint} and key = 'blocked'`;
    const res = await call(app, "alice", "DELETE", `/v1/statuses/${blocked.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("STATUS_IN_USE");
    expect(res.body.error.details.statusKeys).toEqual(["blocked"]);
    expect(await orphanCount()).toBe(0);
  });

  it("rejects hiding an in-use status without a remap target", async () => {
    const res = await call(app, "alice", "POST", `/v1/containers/${ids.Sprint}/statuses`, {
      key: "in_review",
      hidden: true,
    });
    expect(res.status).toBe(409);
    expect(await orphanCount()).toBe(0);
  });

  it("rejects a remap target that is not in the affected list", async () => {
    const [blocked] =
      await sql`select id from statuses where owner_id = ${ids.Sprint} and key = 'blocked'`;
    const res = await call(app, "alice", "DELETE", `/v1/statuses/${blocked.id}?remapTo=nope`);
    expect(res.status).toBe(400);
    expect(paths(res)).toEqual(["query.remapTo"]);
    expect(await orphanCount()).toBe(0);
  });

  it("deletes an in-use status with remapTo, moving its tasks first", async () => {
    const [blocked] =
      await sql`select id from statuses where owner_id = ${ids.Sprint} and key = 'blocked'`;
    const before =
      await sql`select id from tasks where list_id = ${ids.Sprint} and status_key = 'blocked'`;
    expect(before.length).toBeGreaterThan(0);

    const res = await call(app, "alice", "DELETE", `/v1/statuses/${blocked.id}?remapTo=todo`);
    expect(res.status).toBe(204);
    const after =
      await sql`select status_key from tasks where id in ${sql(before.map((t) => t.id))}`;
    expect(after.every((t) => t.statusKey === "todo")).toBe(true);
    expect(await orphanCount()).toBe(0);

    const board = await call(app, "alice", "GET", `/v1/containers/${ids.Sprint}/resolved-statuses`);
    expect(board.body.data.map((s: { key: string }) => s.key)).not.toContain("blocked");
  });
});

describe("board actions", () => {
  it("moves a card to another column, before a given card", async () => {
    const card = await taskId("Webhook retries with backoff"); // Sprint todo
    const anchor = await taskId("Drag cards between columns"); // Sprint in_progress
    const res = await call(app, "alice", "PATCH", `/v1/tasks/${card}`, {
      statusKey: "in_progress",
      beforeId: anchor,
    });
    expect(res.status).toBe(200);
    const column = await call(
      app,
      "alice",
      "GET",
      `/v1/lists/${ids.Sprint}/tasks?statusKey=in_progress`,
    );
    expect(column.body.data.map((t: { id: string }) => t.id).slice(0, 2)).toEqual([card, anchor]);
  });
});

describe("pagination and sorting", () => {
  it("walks every task once with a cursor", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const q: string = cursor ? `&cursor=${cursor}` : "";
      const res = await call(
        app,
        "alice",
        "GET",
        `/v1/lists/${ids.Backlog}/tasks?limit=3&sort=dueDate${q}`,
      );
      expect(res.status).toBe(200);
      seen.push(...res.body.data.map((t: { id: string }) => t.id));
      cursor = res.body.nextCursor;
    } while (cursor);
    const [{ count }] =
      await sql`select count(*)::int as count from tasks where list_id = ${ids.Backlog}`;
    expect(seen).toHaveLength(count);
    expect(new Set(seen).size).toBe(count);
  });

  it("sorts by priority, urgent first", async () => {
    const res = await call(app, "alice", "GET", `/v1/lists/${ids.Backlog}/tasks?sort=priority`);
    expect(res.body.data[0].priority).toBe("urgent");
  });

  it("filters by a custom field value, including multi_select items", async () => {
    const res = await call(
      app,
      "alice",
      "GET",
      `/v1/lists/${ids.Backlog}/tasks?fieldKey=team&fieldValue=infra`,
    );
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(
      res.body.data.every(
        (t: { customFields: { team: string } }) => t.customFields.team === "infra",
      ),
    ).toBe(true);
  });

  it("rejects a cursor that the API did not issue", async () => {
    const res = await call(app, "alice", "GET", `/v1/lists/${ids.Backlog}/tasks?cursor=garbage`);
    expect(res.status).toBe(400);
    expect(paths(res)).toEqual(["query.cursor"]);
  });
});
