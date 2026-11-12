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

const schemaKeys = async (list: string) => {
  const res = await call(app, "alice", "GET", `/v1/containers/${ids[list]}/resolved-fields`);
  return res.body.data.map((f: { key: string }) => f.key);
};
const fieldId = async (key: string) =>
  (await sql`select id from field_definitions where key = ${key}`)[0].id;

describe("field resolution", () => {
  it("inherits definitions from every ancestor", async () => {
    expect(await schemaKeys("Backlog")).toEqual(["estimate", "team", "labels"]);
    expect(await schemaKeys("Sprint")).toEqual(["estimate", "team", "labels", "review_date"]);
    expect(await schemaKeys("Pipeline")).toEqual(["stage", "remote"]);
  });
});

describe("field config", () => {
  it("rejects a key that an ancestor already defines", async () => {
    const res = await call(app, "alice", "POST", `/v1/containers/${ids.Sprint}/fields`, {
      key: "estimate",
      name: "Hours",
      type: "number",
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: "FIELD_KEY_COLLISION",
      details: { ownerName: "Engineering" },
    });
  });

  it("rejects a key that a descendant already defines", async () => {
    const res = await call(app, "alice", "POST", `/v1/containers/${ids.Engineering}/fields`, {
      key: "review_date",
      name: "Review",
      type: "date",
    });
    expect(res.status).toBe(409);
    expect(res.body.error.details.ownerName).toBe("Sprint");
  });

  it("allows the same key in two separate subtrees", async () => {
    const res = await call(app, "alice", "POST", `/v1/containers/${ids.Pipeline}/fields`, {
      key: "review_date",
      name: "Debrief date",
      type: "date",
    });
    expect(res.status).toBe(201);
  });

  it("requires options for select types only", async () => {
    const res = await call(app, "alice", "POST", `/v1/containers/${ids.Backlog}/fields`, {
      key: "size",
      name: "Size",
      type: "single_select",
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("options");
  });

  it("refuses a type change", async () => {
    const res = await call(app, "alice", "PATCH", `/v1/fields/${await fieldId("estimate")}`, {
      type: "text",
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("FIELD_TYPE_LOCKED");
  });

  it("refuses to remove an option that tasks use, and allows a label change", async () => {
    const id = await fieldId("team");
    const removed = await call(app, "alice", "PATCH", `/v1/fields/${id}`, {
      options: [
        { id: "web", label: "Web" },
        { id: "api", label: "API" },
      ],
    });
    expect(removed.status).toBe(409);
    expect(removed.body.error.details).toMatchObject({ options: ["infra"] });

    const relabel = await call(app, "alice", "PATCH", `/v1/fields/${id}`, {
      options: [
        { id: "web", label: "Frontend" },
        { id: "api", label: "API" },
        { id: "infra", label: "Platform" },
      ],
    });
    expect(relabel.status).toBe(200);
  });

  it("archives a field: it leaves the schema, its values stay, unarchive restores it", async () => {
    const id = await fieldId("labels");
    expect((await call(app, "alice", "DELETE", `/v1/fields/${id}`)).status).toBe(204);
    expect(await schemaKeys("Backlog")).not.toContain("labels");
    const [{ count }] =
      await sql`select count(*)::int as count from tasks where custom_fields ? 'labels'`;
    expect(count).toBeGreaterThan(0);

    expect((await call(app, "alice", "POST", `/v1/fields/${id}/unarchive`)).status).toBe(200);
    expect(await schemaKeys("Backlog")).toContain("labels");
  });

  it("lets only an admin change fields", async () => {
    const res = await call(app, "carol", "POST", `/v1/containers/${ids.Backlog}/fields`, {
      key: "x",
      name: "X",
      type: "text",
    });
    expect(res.status).toBe(403);
  });
});
