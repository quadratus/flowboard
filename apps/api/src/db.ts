import postgres from "postgres";

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env, or start the stack with docker compose.",
    );
  }
  return postgres(url, {
    // Rename columns only (parent_id <-> parentId). postgres.camel also renames keys inside
    // jsonb values, which would turn the field key "due_review" into "dueReview".
    transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } },
    onnotice: () => {}, // hide "already exists, skipping" notices
  });
}

export type Sql = ReturnType<typeof createDb>;
export type Tx = postgres.TransactionSql;
/** A pool or a transaction: both run tagged queries. */
export type Queryable = postgres.ISql;
