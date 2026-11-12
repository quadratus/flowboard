/**
 * End-to-end flows against the running stack (nginx → api → Postgres), over real HTTP.
 * Each run builds its own folder under "Engineering", so it does not depend on or break the
 * demo data, and it archives the folder at the end. Seed users and grants are the only input.
 *
 * Run: make e2e   (or E2E_BASE_URL=http://localhost:8080 E2E=1 pnpm --filter api exec vp test)
 */
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:8080";
const run = Date.now().toString(36);

type Res = { status: number; body: any };

async function api(as: string | null, method: string, path: string, body?: object): Promise<Res> {
  const headers: Record<string, string> = {};
  if (as) headers["x-user-id"] = as;
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

const ok = async (p: Promise<Res>, status = 200) => {
  const res = await p;
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
};
const columnKeys = async (listId: string, as = "alice") =>
  (await ok(api(as, "GET", `/v1/containers/${listId}/resolved-statuses`))).data.map(
    (s: { key: string }) => s.key,
  );
const treeIds = async (as: string) =>
  (await ok(api(as, "GET", "/v1/tree"))).data.map((c: { id: string }) => c.id);

let folder: string;
let listA: string;
let listB: string;
let users: Record<string, string>;

beforeAll(async () => {
  const health = await fetch(`${BASE}/v1/health`).catch(() => null);
  if (!health?.ok) throw new Error(`The stack is not running at ${BASE}. Run \`make up\` first.`);

  users = Object.fromEntries(
    (await ok(api("alice", "GET", "/v1/users"))).data.map((u: { handle: string; id: string }) => [
      u.handle,
      u.id,
    ]),
  );
  const tree = (await ok(api("alice", "GET", "/v1/tree"))).data;
  const engineering = tree.find(
    (c: { name: string; type: string }) => c.type === "space" && c.name === "Engineering",
  );

  folder = (
    await ok(
      api("alice", "POST", "/v1/containers", {
        parentId: engineering.id,
        type: "folder",
        name: `E2E ${run}`,
      }),
      201,
    )
  ).id;
  listA = (
    await ok(
      api("alice", "POST", "/v1/containers", { parentId: folder, type: "list", name: "Intake" }),
      201,
    )
  ).id;
  listB = (
    await ok(
      api("alice", "POST", "/v1/containers", { parentId: folder, type: "list", name: "Delivery" }),
      201,
    )
  ).id;
});

afterAll(async () => {
  if (folder) await api("alice", "POST", `/v1/containers/${folder}/archive`);
});

describe("auth boundary over HTTP", () => {
  it("rejects a request without identity with the standard error shape", async () => {
    const res = await api(null, "GET", "/v1/tree");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHENTICATED", message: expect.any(String) } });
  });
});

describe("flow 1: an admin configures two sibling lists with different boards", () => {
  it("starts both lists with the inherited Engineering columns", async () => {
    const expected = ["todo", "in_progress", "in_review", "done"];
    expect(await columnKeys(listA)).toEqual(expected);
    expect(await columnKeys(listB)).toEqual(expected);
  });

  it("gives each list its own columns", async () => {
    await ok(
      api("alice", "POST", `/v1/containers/${listA}/statuses`, {
        key: "triage",
        name: "Triage",
        category: "not_started",
        color: "#f59e0b",
      }),
      201,
    );
    await ok(
      api("alice", "POST", `/v1/containers/${listA}/statuses`, { key: "in_review", hidden: true }),
      201,
    );
    await ok(
      api("alice", "POST", `/v1/containers/${listB}/statuses`, {
        key: "qa",
        name: "QA",
        category: "active",
        color: "#06b6d4",
      }),
      201,
    );

    expect(await columnKeys(listA)).toEqual(["todo", "in_progress", "done", "triage"]);
    expect(await columnKeys(listB)).toEqual(["todo", "in_progress", "in_review", "done", "qa"]);
  });

  it("adds a required field on the folder that both lists inherit", async () => {
    await ok(
      api("alice", "POST", `/v1/containers/${folder}/fields`, {
        key: `risk_${run}`,
        name: "Risk",
        type: "single_select",
        required: true,
        options: [
          { id: "low", label: "Low" },
          { id: "high", label: "High" },
        ],
      }),
      201,
    );
    for (const list of [listA, listB]) {
      const schema = (await ok(api("alice", "GET", `/v1/containers/${list}/resolved-fields`))).data;
      expect(schema.map((f: { key: string }) => f.key)).toContain(`risk_${run}`);
    }
  });
});

describe("flow 2: a member works a task from intake to delivery", () => {
  let task: string;
  const risk = () => `risk_${run}`;

  it("rejects a task that misses required values, with every field path", async () => {
    const res = await api("bob", "POST", `/v1/lists/${listA}/tasks`, {
      title: "Customer import fails",
      statusKey: "triage",
      customFields: { estimate: "3" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path).toSorted()).toEqual(
      [`customFields.${risk()}`, "customFields.estimate"].toSorted(),
    );
  });

  it("creates the task when the values are valid", async () => {
    const body = await ok(
      api("bob", "POST", `/v1/lists/${listA}/tasks`, {
        title: "Customer import fails",
        statusKey: "triage",
        priority: "high",
        assigneeIds: [users.bob],
        customFields: { estimate: 3, [risk()]: "high", team: "api" },
      }),
      201,
    );
    task = body.id;
    expect(body).toMatchObject({ statusKey: "triage", priority: "high", assigneeIds: [users.bob] });
  });

  it("moves the card across columns on the board", async () => {
    const body = await ok(api("bob", "PATCH", `/v1/tasks/${task}`, { statusKey: "in_progress" }));
    expect(body.statusKey).toBe("in_progress");
    const column = await ok(api("bob", "GET", `/v1/lists/${listA}/tasks?statusKey=in_progress`));
    expect(column.data.map((t: { id: string }) => t.id)).toContain(task);
  });

  it("blocks a move to Delivery while the task sits in a column Delivery lacks", async () => {
    await ok(api("bob", "PATCH", `/v1/tasks/${task}`, { statusKey: "triage" }));
    const res = await api("bob", "POST", `/v1/tasks/${task}/move`, { listId: listB });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("statusKey");
  });

  it("moves to Delivery with an explicit column and keeps shared field values", async () => {
    const body = await ok(
      api("bob", "POST", `/v1/tasks/${task}/move`, { listId: listB, statusKey: "qa" }),
    );
    expect(body).toMatchObject({ listId: listB, statusKey: "qa", strippedFields: [] });
    expect(body.customFields).toEqual({ estimate: 3, [risk()]: "high", team: "api" });
  });
});

describe("flow 3: config changes never orphan a card", () => {
  it("refuses to delete a column that holds cards", async () => {
    const local = (await ok(api("alice", "GET", `/v1/containers/${listB}/statuses`))).data;
    const qa = local.find((s: { key: string }) => s.key === "qa");
    const res = await api("alice", "DELETE", `/v1/statuses/${qa.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("STATUS_IN_USE");
  });

  it("deletes the column with a remap, and every card lands in a valid column", async () => {
    const local = (await ok(api("alice", "GET", `/v1/containers/${listB}/statuses`))).data;
    const qa = local.find((s: { key: string }) => s.key === "qa");
    await ok(api("alice", "DELETE", `/v1/statuses/${qa.id}?remapTo=in_review`), 204);

    const columns = await columnKeys(listB);
    const cards = (await ok(api("alice", "GET", `/v1/lists/${listB}/tasks`))).data;
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) expect(columns).toContain(card.statusKey);
  });
});

describe("flow 4: privacy changes take effect for members at once", () => {
  it("hides a list from Bob when it becomes private, and returns 403 on its tasks", async () => {
    expect(await treeIds("bob")).toContain(listB);
    await ok(api("alice", "PATCH", `/v1/containers/${listB}`, { isPrivate: true }));

    expect(await treeIds("bob")).not.toContain(listB);
    expect((await api("bob", "GET", `/v1/lists/${listB}/tasks`)).status).toBe(403);
    expect(await treeIds("alice")).toContain(listB);
  });

  it("shows the list again after an explicit allow grant", async () => {
    await ok(api("alice", "PUT", `/v1/containers/${listB}/grants/${users.bob}`, { mode: "allow" }));
    expect(await treeIds("bob")).toContain(listB);
    expect((await api("bob", "GET", `/v1/lists/${listB}/tasks`)).status).toBe(200);
  });

  it("does not let a member change who can see what", async () => {
    const res = await api("bob", "PUT", `/v1/containers/${listA}/grants/${users.carol}`, {
      mode: "deny",
    });
    expect(res.status).toBe(403);
  });
});
