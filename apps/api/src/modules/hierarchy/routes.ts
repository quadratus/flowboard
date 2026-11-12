import { Type, type FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { Queryable, Tx } from "../../db.ts";
import { invalid, notFound } from "../../shared/errors.ts";
import { placeAmong, type Sibling } from "../../shared/position.ts";
import { AnchorProps, Id, IdParams } from "../../shared/schema.ts";
import { requireAccess, requireAdmin } from "../permissions/access.ts";

export type ContainerType = "workspace" | "space" | "folder" | "list";

/** The only valid parent type for each child type (spec: workspace → space → folder → list). */
const PARENT_TYPE: Record<Exclude<ContainerType, "workspace">, ContainerType> = {
  space: "workspace",
  folder: "space",
  list: "folder",
};

const ContainerTypeSchema = Type.Union([
  Type.Literal("space"),
  Type.Literal("folder"),
  Type.Literal("list"),
]);
const Name = Type.String({ minLength: 1, maxLength: 200 });

const columns = (sql: Queryable) => sql`id, type, parent_id, name, position, is_private`;

/**
 * Locks the parent row, so that two writes to the same sibling group run one at a time.
 * Without the lock, two inserts can compute the same position key.
 */
async function lockParent(
  tx: Tx,
  parentId: string,
  childType: Exclude<ContainerType, "workspace">,
) {
  const [parent] = await tx<{ type: ContainerType }[]>`
    select type from containers where id = ${parentId} and archived_at is null for update`;
  if (!parent) throw notFound("Parent container");
  if (parent.type !== PARENT_TYPE[childType]) {
    throw invalid([
      {
        path: "parentId",
        issue: `a ${childType} must be inside a ${PARENT_TYPE[childType]}, not a ${parent.type}`,
      },
    ]);
  }
}

const siblingsOf = (tx: Tx, parentId: string, excludeId: string | null) => tx<Sibling[]>`
  select id, position from containers
  where parent_id = ${parentId} and archived_at is null and id is distinct from ${excludeId}
  order by position`;

export const hierarchy: FastifyPluginAsyncTypebox = async (app) => {
  const { sql } = app;

  /**
   * Visible tree for the caller, as a flat array (the client builds the nesting).
   * The walk goes down from the workspace and stops at each container the caller cannot see,
   * so the children of a hidden container are never visited.
   */
  app.get("/v1/tree", async (req) => {
    const isAdmin = req.user.role === "admin";
    const data = await sql`
      with recursive visible as (
        select c.*, 0 as depth from containers c where c.type = 'workspace'
        union all
        select c.*, v.depth + 1 from containers c
        join visible v on c.parent_id = v.id
        where c.archived_at is null
          and (
            ${isAdmin}
            or (
              not exists (select 1 from grants g
                          where g.container_id = c.id and g.user_id = ${req.user.id} and g.mode = 'deny')
              and (not c.is_private
                   or exists (select 1 from grants g
                              where g.container_id = c.id and g.user_id = ${req.user.id} and g.mode = 'allow'))
            )
          )
      )
      select ${columns(sql)} from visible order by depth, position`; // parents before children
    return { data };
  });

  app.get("/v1/containers/:id", { schema: { params: IdParams } }, async (req) => {
    await requireAccess(sql, req, req.params.id);
    const [container] =
      await sql`select ${columns(sql)} from containers where id = ${req.params.id}`;
    return container;
  });

  app.post(
    "/v1/containers",
    {
      schema: {
        body: Type.Object(
          {
            parentId: Id,
            type: ContainerTypeSchema,
            name: Name,
            isPrivate: Type.Optional(Type.Boolean()),
            ...AnchorProps,
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req, reply) => {
      requireAdmin(req);
      const { parentId, type, name, isPrivate = false } = req.body;
      const created = await sql.begin(async (tx) => {
        await lockParent(tx, parentId, type);
        const position = placeAmong(await siblingsOf(tx, parentId, null), req.body);
        const [row] = await tx`
          insert into containers (type, parent_id, name, position, is_private)
          values (${type}, ${parentId}, ${name}, ${position}, ${isPrivate})
          returning ${columns(tx)}`;
        return row;
      });
      return reply.code(201).send(created);
    },
  );

  app.patch(
    "/v1/containers/:id",
    {
      schema: {
        params: IdParams,
        body: Type.Object(
          { name: Type.Optional(Name), isPrivate: Type.Optional(Type.Boolean()) },
          { additionalProperties: false, minProperties: 1 },
        ),
      },
    },
    async (req) => {
      requireAdmin(req);
      const { name, isPrivate } = req.body;
      const [row] = await sql`
        update containers set
          name = coalesce(${name ?? null}, name),
          is_private = coalesce(${isPrivate ?? null}, is_private)
        where id = ${req.params.id} and archived_at is null
        returning ${columns(sql)}`;
      if (!row) throw notFound("Container");
      return row;
    },
  );

  /**
   * Reorder among siblings, or move to a new parent of the same parent type.
   * Each type has exactly one parent type, so a container can never move into its own subtree.
   */
  app.post(
    "/v1/containers/:id/move",
    {
      schema: {
        params: IdParams,
        body: Type.Object(
          { parentId: Type.Optional(Id), ...AnchorProps },
          { additionalProperties: false },
        ),
      },
    },
    async (req) => {
      requireAdmin(req);
      return sql.begin(async (tx) => {
        const [current] = await tx<{ type: ContainerType; parentId: string | null }[]>`
          select type, parent_id from containers where id = ${req.params.id} and archived_at is null`;
        if (!current) throw notFound("Container");
        if (current.type === "workspace")
          throw invalid([{ path: "id", issue: "the workspace cannot move" }]);

        const parentId = req.body.parentId ?? current.parentId!;
        await lockParent(tx, parentId, current.type);
        const position = placeAmong(await siblingsOf(tx, parentId, req.params.id), req.body);
        const [row] = await tx`
          update containers set parent_id = ${parentId}, position = ${position}
          where id = ${req.params.id}
          returning ${columns(tx)}`;
        return row;
      });
    },
  );

  /** Soft delete. Descendants stay untouched; the access check hides them through the archived ancestor. */
  app.post("/v1/containers/:id/archive", { schema: { params: IdParams } }, async (req, reply) => {
    requireAdmin(req);
    const [row] = await sql`
      update containers set archived_at = now()
      where id = ${req.params.id} and archived_at is null and type <> 'workspace'
      returning id`;
    if (!row) throw notFound("Container");
    return reply.code(204).send();
  });

  /** Restores the container at the end of its siblings: its old position key may be in use now. */
  app.post("/v1/containers/:id/unarchive", { schema: { params: IdParams } }, async (req) => {
    requireAdmin(req);
    return sql.begin(async (tx) => {
      const [current] = await tx<{ type: Exclude<ContainerType, "workspace">; parentId: string }[]>`
        select type, parent_id from containers where id = ${req.params.id} and archived_at is not null`;
      if (!current) throw notFound("Archived container");
      await lockParent(tx, current.parentId, current.type);
      const position = placeAmong(await siblingsOf(tx, current.parentId, req.params.id), {});
      const [row] = await tx`
        update containers set archived_at = null, position = ${position}
        where id = ${req.params.id}
        returning ${columns(tx)}`;
      return row;
    });
  });
};
