import Fastify from "fastify";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env, or start the stack with docker compose.",
  );
}

const sql = postgres(databaseUrl);
const app = Fastify({ logger: true });

app.get("/v1/health", async () => {
  await sql`select 1`;
  return { status: "ok" };
});

await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 3000) });
