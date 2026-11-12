import { buildApp, type App } from "../src/app.ts";
import { createDb, type Sql } from "../src/db.ts";
import { migrate } from "../src/migrate.ts";
import { seed } from "../src/seed.ts";

/** Tests never touch the dev database: they use <db>_test on the same server. */
export function testDatabaseUrl() {
  const url = new URL(
    process.env.TEST_DATABASE_URL ??
      process.env.DATABASE_URL ??
      "postgres://flowboard:flowboard@localhost:5432/flowboard",
  );
  if (!process.env.TEST_DATABASE_URL) url.pathname = `${url.pathname}_test`;
  return url.toString();
}

/** Drops every table, migrates and seeds. Call it in beforeAll, so each test file starts from the seed. */
export async function freshApp(): Promise<{ app: App; sql: Sql; ids: Record<string, string> }> {
  await ensureDatabase(testDatabaseUrl());
  const sql = createDb(testDatabaseUrl());
  await sql`drop schema public cascade`;
  await sql`create schema public`;
  await migrate(sql);
  await seed(sql);

  const rows = await sql<{ name: string; id: string }[]>`
    select name, id from containers
    union all select handle, id from users`;
  const ids = Object.fromEntries(rows.map((r) => [r.name, r.id]));
  return { app: buildApp({ sql }), sql, ids };
}

/** Creates the test database on first use, through the server's default `postgres` database. */
async function ensureDatabase(url: string) {
  const admin = new URL(url);
  const name = admin.pathname.slice(1);
  admin.pathname = "/postgres";
  const sql = createDb(admin.toString());
  const [exists] = await sql`select 1 from pg_database where datname = ${name}`;
  if (!exists) await sql.unsafe(`create database "${name.replaceAll('"', '""')}"`);
  await sql.end();
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** One request as a user. `as: null` sends no identity header. */
export async function call(
  app: App,
  as: string | null,
  method: Method,
  url: string,
  payload?: object,
) {
  const res = await app.inject({
    method,
    url,
    headers: as ? { "x-user-id": as } : {},
    ...(payload ? { payload } : {}),
  });
  return { status: res.statusCode, body: res.body ? res.json() : undefined };
}
