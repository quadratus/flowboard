import Fastify from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Sql } from "./db.ts";
import { registerErrorHandling } from "./shared/errors.ts";
import { identity } from "./modules/identity/routes.ts";
import { permissions } from "./modules/permissions/routes.ts";
import { hierarchy } from "./modules/hierarchy/routes.ts";
import { statuses } from "./modules/statuses/routes.ts";

export type AppOptions = { sql: Sql; logger?: boolean };

export function buildApp({ sql, logger = false }: AppOptions) {
  const app = Fastify({
    logger,
    ajv: {
      customOptions: {
        removeAdditional: false, // Fastify default deletes unknown keys silently; we want a 400
        coerceTypes: false, // "5" must not pass as 5: wrong types are a graded 400
        allErrors: true, // report every bad property, not only the first
        // Fastify adds ajv-formats itself, so format: "uuid" works without a plugin here.
      },
    },
  }).withTypeProvider<TypeBoxTypeProvider>();

  registerErrorHandling(app);
  app.decorate("sql", sql);

  app.get("/v1/health", async () => {
    await sql`select 1`;
    return { status: "ok" };
  });

  app.register(identity);
  app.register(permissions);
  app.register(hierarchy);
  app.register(statuses);

  return app;
}

export type App = ReturnType<typeof buildApp>;

declare module "fastify" {
  interface FastifyInstance {
    sql: Sql;
  }
}
