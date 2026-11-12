import { Type, type FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { invalid, notFound } from "../../shared/errors.ts";
import { Id, IdParams } from "../../shared/schema.ts";
import { requireAdmin } from "./access.ts";

const GrantParams = Type.Object({ id: Id, userId: Id });

export const permissions: FastifyPluginAsyncTypebox = async (app) => {
  const { sql } = app;

  async function grantTarget(id: string) {
    const [c] = await sql<{ type: string }[]>`
      select type from containers where id = ${id} and archived_at is null`;
    if (!c) throw notFound("Container");
    if (c.type === "workspace")
      throw invalid([{ path: "id", issue: "grants attach to a space, folder or list" }]);
  }

  app.get("/v1/containers/:id/grants", { schema: { params: IdParams } }, async (req) => {
    requireAdmin(req);
    await grantTarget(req.params.id);
    const data = await sql`
      select g.user_id, u.handle, g.mode
      from grants g join users u on u.id = g.user_id
      where g.container_id = ${req.params.id}
      order by u.handle`;
    return { data };
  });

  app.put(
    "/v1/containers/:id/grants/:userId",
    {
      schema: {
        params: GrantParams,
        body: Type.Object(
          { mode: Type.Union([Type.Literal("allow"), Type.Literal("deny")]) },
          { additionalProperties: false },
        ),
      },
    },
    async (req) => {
      requireAdmin(req);
      await grantTarget(req.params.id);
      const [user] = await sql`select 1 from users where id = ${req.params.userId}`;
      if (!user) throw notFound("User");
      const [grant] = await sql`
        insert into grants (container_id, user_id, mode)
        values (${req.params.id}, ${req.params.userId}, ${req.body.mode})
        on conflict (container_id, user_id) do update set mode = excluded.mode
        returning container_id, user_id, mode`;
      return grant;
    },
  );

  app.delete(
    "/v1/containers/:id/grants/:userId",
    { schema: { params: GrantParams } },
    async (req, reply) => {
      requireAdmin(req);
      await sql`delete from grants where container_id = ${req.params.id} and user_id = ${req.params.userId}`;
      return reply.code(204).send();
    },
  );
};
