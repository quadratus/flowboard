import type { FastifyRequest } from "fastify";
import type { Sql } from "../../db.ts";
import { forbidden, notFound } from "../../shared/errors.ts";

/** Throws 404 or 403 unless the caller can see the container (path rule, migration 001). */
export async function requireAccess(
  sql: Sql,
  req: FastifyRequest,
  containerId: string,
  what = "Container",
) {
  const [{ result }] = await sql<{ result: string }[]>`
    select access_check(${req.user.id}, ${containerId}) as result`;
  if (result === "not_found") throw notFound(what);
  if (result === "forbidden") throw forbidden();
}

/** Config writes (containers, statuses, fields, grants) are admin only. */
export function requireAdmin(req: FastifyRequest) {
  if (req.user.role !== "admin")
    throw forbidden("Only an admin can change workspace configuration");
}
