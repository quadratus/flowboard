import Fastify from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import type { Sql } from "./db.ts";
import { registerErrorHandling } from "./shared/errors.ts";
import { identity } from "./modules/identity/routes.ts";
import { permissions } from "./modules/permissions/routes.ts";
import { hierarchy } from "./modules/hierarchy/routes.ts";
import { statuses } from "./modules/statuses/routes.ts";
import { fields } from "./modules/fields/routes.ts";
import { tasks } from "./modules/tasks/routes.ts";

export type AppOptions = { sql: Sql; logger?: boolean };

export function buildApp({ sql, logger = false }: AppOptions) {
  const app = Fastify({ logger }).withTypeProvider<TypeBoxTypeProvider>();

  // Bodies are strict: "5" must not pass as 5, because wrong types are a graded 400.
  // URL parts are always strings, so the query and params need coercion ("?limit=3" → 3).
  const strict = makeAjv(false);
  const coercing = makeAjv(true);
  app.setValidatorCompiler(({ schema, httpPart }) =>
    (httpPart === "body" ? strict : coercing).compile(schema),
  );

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
  app.register(fields);
  app.register(tasks);

  return app;
}

function makeAjv(coerceTypes: boolean) {
  const ajv = new Ajv({
    coerceTypes,
    removeAdditional: false, // unknown keys are a 400, not silently dropped
    useDefaults: true,
    allErrors: true, // report every bad property, not only the first
  });
  // CJS default export: under nodenext the callable plugin sits on .default.
  addFormats.default(ajv);
  return ajv;
}

export type App = ReturnType<typeof buildApp>;

declare module "fastify" {
  interface FastifyInstance {
    sql: Sql;
  }
}
