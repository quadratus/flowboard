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

const listNames = async (folder: string) => {
  const { body } = await call(app, "alice", "GET", "/v1/tree");
  return body.data
    .filter((c: { parentId: string }) => c.parentId === ids[folder])
    .map((c: { name: string }) => c.name);
};

describe("create", () => {
  it("appends a list at the end of its folder", async () => {
    const res = await call(app, "alice", "POST", "/v1/containers", {
      parentId: ids["Q2 Launch"],
      type: "list",
      name: "Done",
    });
    expect(res.status).toBe(201);
    expect(await listNames("Q2 Launch")).toEqual(["Backlog", "Sprint", "Done"]);
  });

  it("rejects a list directly inside a space", async () => {
    const res = await call(app, "alice", "POST", "/v1/containers", {
      parentId: ids.Engineering,
      type: "list",
      name: "Orphan",
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("parentId");
  });

  it("rejects unknown properties and bad ids with a field path", async () => {
    const res = await call(app, "alice", "POST", "/v1/containers", {
      parentId: "nope",
      type: "list",
      name: "",
      colour: "red",
    });
    expect(res.status).toBe(400);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["parentId", "name", "colour"]));
  });
});

describe("reorder and move", () => {
  it("places a list before another sibling", async () => {
    const res = await call(app, "alice", "POST", `/v1/containers/${ids.Sprint}/move`, {
      beforeId: ids.Backlog,
    });
    expect(res.status).toBe(200);
    expect((await listNames("Q2 Launch")).slice(0, 2)).toEqual(["Sprint", "Backlog"]);
  });

  it("moves a list to another folder", async () => {
    const res = await call(app, "alice", "POST", `/v1/containers/${ids.Backlog}/move`, {
      parentId: ids.Hiring,
    });
    expect(res.status).toBe(200);
    expect(await listNames("Hiring")).toEqual(["Pipeline", "Backlog"]);
  });

  it("rejects a move to a parent of the wrong type", async () => {
    const res = await call(app, "alice", "POST", `/v1/containers/${ids.Backlog}/move`, {
      parentId: ids.Workspace ?? ids.Flowboard,
    });
    expect(res.status).toBe(400);
  });

  it("rejects an anchor that is not a sibling", async () => {
    const res = await call(app, "alice", "POST", `/v1/containers/${ids.Sprint}/move`, {
      afterId: ids.Pipeline,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("afterId");
  });
});

describe("archive", () => {
  it("hides an archived folder and its lists, and 404s direct reads", async () => {
    expect(
      (await call(app, "alice", "POST", `/v1/containers/${ids["Q2 Launch"]}/archive`)).status,
    ).toBe(204);
    const { body } = await call(app, "alice", "GET", "/v1/tree");
    expect(body.data.map((c: { name: string }) => c.name)).not.toContain("Sprint");
    expect((await call(app, "alice", "GET", `/v1/containers/${ids.Sprint}`)).status).toBe(404);
  });

  it("restores the folder at the end of its siblings", async () => {
    const res = await call(app, "alice", "POST", `/v1/containers/${ids["Q2 Launch"]}/unarchive`);
    expect(res.status).toBe(200);
    expect((await call(app, "alice", "GET", `/v1/containers/${ids.Sprint}`)).status).toBe(200);
  });
});
