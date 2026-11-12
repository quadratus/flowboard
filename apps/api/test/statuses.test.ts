import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
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

type Column = { id: string; key: string; name: string; inherited: boolean; ownerId: string };

const columns = async (container: string, as = "alice"): Promise<Column[]> => {
  const res = await call(app, as, "GET", `/v1/containers/${ids[container]}/resolved-statuses`);
  expect(res.status).toBe(200);
  return res.body.data;
};
const keys = async (container: string) => (await columns(container)).map((c) => c.key);
const names = async (container: string) => (await columns(container)).map((c) => c.name);

describe("status resolution", () => {
  it("resolves different column sets for sibling lists A and B in the same folder", async () => {
    expect(await names("Backlog")).toEqual(["To do", "In progress", "Shipped"]);
    expect(await names("Sprint")).toEqual([
      "To do",
      "In progress",
      "In review",
      "Blocked",
      "Shipped",
    ]);
  });

  it("inherits the workspace defaults where no level changes anything", async () => {
    expect(await names("Pipeline")).toEqual(["To do", "In progress", "Done"]);
  });

  it("marks where each column comes from", async () => {
    const sprint = await columns("Sprint");
    const blocked = sprint.find((c) => c.key === "blocked")!;
    const done = sprint.find((c) => c.key === "done")!;
    expect(blocked).toMatchObject({ inherited: false, ownerId: ids.Sprint });
    expect(done).toMatchObject({ inherited: true, ownerId: ids["Q2 Launch"], name: "Shipped" });
  });

  it("returns 403 when Bob asks for the columns of a denied list", async () => {
    const res = await call(app, "bob", "GET", `/v1/containers/${ids.Sprint}/resolved-statuses`);
    expect(res.status).toBe(403);
  });
});

describe("status config", () => {
  // Each test changes the config, so it removes its own rows afterwards.
  const created: string[] = [];
  beforeEach(async () => {
    for (const id of created.splice(0)) await sql`delete from statuses where id = ${id}`;
  });

  const add = async (container: string, body: object, as = "alice") => {
    const res = await call(app, as, "POST", `/v1/containers/${ids[container]}/statuses`, body);
    if (res.status === 201) created.push(res.body.id);
    return res;
  };

  it("adds a status on a list, after a given column", async () => {
    const sprint = await columns("Sprint");
    const res = await add("Sprint", {
      key: "qa",
      name: "QA",
      category: "active",
      color: "#f59e0b",
      afterId: sprint.find((c) => c.key === "in_review")!.id,
    });
    expect(res.status).toBe(201);
    expect(await keys("Sprint")).toEqual([
      "todo",
      "in_progress",
      "in_review",
      "qa",
      "blocked",
      "done",
    ]);
    expect(await keys("Backlog")).not.toContain("qa");
  });

  it("overrides an inherited status in place, and only below its level", async () => {
    const res = await add("Backlog", {
      key: "todo",
      name: "Inbox",
      category: "not_started",
      color: "#64748b",
    });
    expect(res.status).toBe(201);
    expect(await names("Backlog")).toEqual(["Inbox", "In progress", "Shipped"]);
    expect((await names("Sprint"))[0]).toBe("To do");
  });

  it("shows a hidden status again when the hide row is deleted", async () => {
    const [hide] = await sql`select id from statuses where owner_id = ${ids.Backlog} and hidden`;
    expect((await call(app, "alice", "DELETE", `/v1/statuses/${hide.id}`)).status).toBe(204);
    expect(await keys("Backlog")).toContain("in_review");
    // Restore the seed row through the API, but keep it out of `created`: later tests rely on it.
    const res = await call(app, "alice", "POST", `/v1/containers/${ids.Backlog}/statuses`, {
      key: "in_review",
      hidden: true,
    });
    expect(res.status).toBe(201);
    expect(await keys("Backlog")).not.toContain("in_review");
  });

  it("rejects a hide that leaves a list without an active status", async () => {
    // Backlog already hides in_review, so in_progress is its only active status.
    const res = await add("Backlog", { key: "in_progress", hidden: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("STATUS_SET_INCOMPLETE");
    expect(res.body.error.details).toEqual([
      { containerId: ids.Backlog, name: "Backlog", missing: ["active"] },
    ]);
    expect(await keys("Backlog")).toContain("in_progress"); // rolled back
  });

  it("checks every list below the level that changes", async () => {
    // Hiding in_progress on the folder is fine for Sprint (in_review, blocked) but not for Backlog.
    const res = await add("Q2 Launch", { key: "in_progress", hidden: true });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { name: string }) => d.name)).toEqual(["Backlog"]);
  });

  it("rejects a category change that removes the only done status", async () => {
    const [shipped] =
      await sql`select id from statuses where owner_id = ${ids["Q2 Launch"]} and key = 'done'`;
    const res = await call(app, "alice", "PATCH", `/v1/statuses/${shipped.id}`, {
      category: "closed",
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("STATUS_SET_INCOMPLETE");
  });

  it("brings the inherited version back when an override is deleted", async () => {
    const [shipped] =
      await sql`select * from statuses where owner_id = ${ids["Q2 Launch"]} and key = 'done'`;
    expect((await call(app, "alice", "DELETE", `/v1/statuses/${shipped.id}`)).status).toBe(204);
    expect((await names("Backlog")).at(-1)).toBe("Done");
    await sql`insert into statuses ${sql(shipped)}`; // restore the seed row
  });

  it("rejects a hide for a key that no ancestor defines", async () => {
    const res = await add("Sprint", { key: "nope", hidden: true });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("key");
  });

  it("rejects a second row for the same key on one level", async () => {
    const res = await add("Sprint", {
      key: "blocked",
      name: "Stuck",
      category: "active",
      color: "#ef4444",
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("STATUS_KEY_EXISTS");
  });

  it("validates the body with field paths", async () => {
    const res = await add("Sprint", { key: "Bad Key", name: "", category: "later", color: "red" });
    expect(res.status).toBe(400);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["key", "name", "category", "color"]));
  });

  it("lets only an admin change statuses", async () => {
    const res = await add(
      "Backlog",
      { key: "later", name: "Later", category: "not_started", color: "#64748b" },
      "bob",
    );
    expect(res.status).toBe(403);
  });
});
