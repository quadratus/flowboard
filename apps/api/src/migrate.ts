import { readdir, readFile } from "node:fs/promises";
import { createDb, type Sql } from "./db.ts";

const dir = new URL("../migrations/", import.meta.url);

// Same key in migrate and seed, so two API replicas never run them at the same time.
export const BOOT_LOCK = 727_274;

/** Applies new files from migrations/ in name order. Returns the names it applied. */
export async function migrate(sql: Sql): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).toSorted();

  // Postgres can roll back DDL, so all new files apply in one transaction: all or nothing.
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${BOOT_LOCK})`;
    await tx`
      create table if not exists schema_migrations (
        name       text primary key,
        applied_at timestamptz not null default now()
      )`;
    const done = new Set(
      (await tx<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name),
    );

    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      await tx.unsafe(await readFile(new URL(file, dir), "utf8"));
      await tx`insert into schema_migrations (name) values (${file})`;
      applied.push(file);
    }
    return applied;
  });
}

if (import.meta.main) {
  const sql = createDb();
  const applied = await migrate(sql);
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "No new migrations.");
  await sql.end();
}
