import { buildApp } from "./app.ts";
import { createDb } from "./db.ts";

const app = buildApp({ sql: createDb(), logger: true });
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 3000) });
