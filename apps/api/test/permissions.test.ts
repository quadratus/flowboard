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

const treeNames = async (as: string) => {
  const res = await call(app, as, "GET", "/v1/tree");
  expect(res.status).toBe(200);
  return res.body.data.map((c: { name: string }) => c.name);
};

describe("auth boundary", () => {
  it("returns 401 without an identity", async () => {
    const res = await call(app, null, "GET", "/v1/tree");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 401 for an unknown user", async () => {
    expect((await call(app, "mallory", "GET", "/v1/tree")).status).toBe(401);
  });

  it("takes the role from the database, not from the request", async () => {
    const res = await call(app, "bob", "GET", "/v1/me");
    expect(res.body.role).toBe("member");
  });
});

describe("tree visibility", () => {
  it("hides private containers from Bob", async () => {
    const names = await treeNames("bob");
    expect(names).not.toContain("Leadership");
    expect(names).not.toContain("Hiring"); // child of a private space
    expect(names).not.toContain("Pipeline");
  });

  it("hides a denied list from Bob", async () => {
    expect(await treeNames("bob")).toEqual(["Flowboard", "Engineering", "Q2 Launch", "Backlog"]);
  });

  it("shows everything to Alice (admin)", async () => {
    const names = await treeNames("alice");
    expect(names).toEqual(
      expect.arrayContaining(["Leadership", "Hiring", "Pipeline", "Sprint", "Backlog"]),
    );
  });

  it("shows a private space to Carol through her allow grant", async () => {
    const names = await treeNames("carol");
    expect(names).toEqual(expect.arrayContaining(["Leadership", "Hiring", "Pipeline", "Sprint"]));
  });

  it("returns parents before children", async () => {
    const { body } = await call(app, "alice", "GET", "/v1/tree");
    const seen = new Set<string>();
    for (const c of body.data) {
      if (c.parentId) expect(seen.has(c.parentId)).toBe(true);
      seen.add(c.id);
    }
  });
});

describe("direct access", () => {
  it("returns 403 when Bob reads a private list", async () => {
    const res = await call(app, "bob", "GET", `/v1/containers/${ids.Pipeline}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 when Bob reads a denied list", async () => {
    expect((await call(app, "bob", "GET", `/v1/containers/${ids.Sprint}`)).status).toBe(403);
  });

  it("lets Carol read the private list", async () => {
    expect((await call(app, "carol", "GET", `/v1/containers/${ids.Pipeline}`)).status).toBe(200);
  });

  it("returns 403 when a member changes configuration", async () => {
    const res = await call(app, "carol", "POST", "/v1/containers", {
      parentId: ids["Q2 Launch"],
      type: "list",
      name: "Sneaky",
    });
    expect(res.status).toBe(403);
  });
});

describe("grants", () => {
  it("shows a container again after an admin deletes the deny grant", async () => {
    const url = `/v1/containers/${ids.Sprint}/grants/${ids.bob}`;
    expect((await call(app, "alice", "DELETE", url)).status).toBe(204);
    expect(await treeNames("bob")).toContain("Sprint");
    expect((await call(app, "alice", "PUT", url, { mode: "deny" })).status).toBe(200);
    expect(await treeNames("bob")).not.toContain("Sprint");
  });
});
