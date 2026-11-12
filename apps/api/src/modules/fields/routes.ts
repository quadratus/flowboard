import { Type, type FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { Queryable, Tx } from "../../db.ts";
import { conflict, invalid, notFound } from "../../shared/errors.ts";
import { placeAmong } from "../../shared/position.ts";
import { AnchorProps, IdParams } from "../../shared/schema.ts";
import { requireAccess, requireAdmin } from "../permissions/access.ts";
import { lockConfig } from "../../shared/locks.ts";
import type { FieldDef, FieldOption, FieldType } from "./validate.ts";

const Key = Type.String({ pattern: "^[a-z][a-z0-9_]{0,39}$" });
const Name = Type.String({ minLength: 1, maxLength: 100 });
const FieldTypeSchema = Type.Union([
  Type.Literal("text"),
  Type.Literal("number"),
  Type.Literal("single_select"),
  Type.Literal("multi_select"),
  Type.Literal("date"),
  Type.Literal("checkbox"),
]);
const Option = Type.Object(
  {
    id: Type.String({ pattern: "^[a-z][a-z0-9_]{0,39}$" }),
    label: Type.String({ minLength: 1, maxLength: 50 }),
    color: Type.Optional(Type.String({ pattern: "^#[0-9a-f]{6}$" })),
  },
  { additionalProperties: false },
);
const Options = Type.Array(Option, { minItems: 1, maxItems: 50 });

export type ResolvedField = FieldDef & {
  id: string;
  name: string;
  position: string;
  ownerId: string;
  depth: number;
};

/** The field schema for a container (migration 003). Callers check access first. */
export const resolvedFields = (sql: Queryable, containerId: string) =>
  sql<ResolvedField[]>`select * from resolved_fields(${containerId})`;

const toApi = ({ depth, ...f }: ResolvedField) => ({ ...f, inherited: depth > 0 });
const isSelect = (t: FieldType) => t === "single_select" || t === "multi_select";

function checkOptions(type: FieldType, options: FieldOption[] | undefined) {
  if (isSelect(type) && !options)
    throw invalid([{ path: "options", issue: `a ${type} field needs options` }]);
  if (!isSelect(type) && options)
    throw invalid([{ path: "options", issue: `a ${type} field has no options` }]);
  if (options && new Set(options.map((o) => o.id)).size !== options.length) {
    throw invalid([{ path: "options", issue: "option ids must be unique" }]);
  }
}

/**
 * Key collisions are explicit (spec §4): a key must be unique on every path from the workspace
 * to a list. So check both directions: an ancestor that already has the key, and a descendant
 * that already has it. Runs under lockConfig, so two admins cannot both pass the check.
 */
async function assertKeyFree(tx: Tx, ownerId: string, key: string, selfId: string | null = null) {
  const [hit] = await tx<{ ownerId: string; ownerName: string }[]>`
    with recursive below as (
      select id from containers where id = ${ownerId}
      union all
      select c.id from containers c join below b on c.parent_id = b.id
    )
    select f.owner_id, c.name as owner_name
    from field_definitions f
    join containers c on c.id = f.owner_id
    where f.key = ${key}
      and f.id is distinct from ${selfId}
      -- Archived definitions keep their key: their values still sit in tasks.custom_fields.
      and (f.owner_id in (select id from ancestors(${ownerId})) or f.owner_id in (select id from below))
    limit 1`;
  if (hit) {
    throw conflict(
      "FIELD_KEY_COLLISION",
      `Field key '${key}' is already defined on '${hit.ownerName}'`,
      {
        key,
        ownerId: hit.ownerId,
        ownerName: hit.ownerName,
      },
    );
  }
}

/** Tasks below `ownerId` that hold a value for `key`. */
async function tasksUsing(tx: Queryable, ownerId: string, key: string, optionIds?: string[]) {
  const [{ count }] = await tx<{ count: number }[]>`
    with recursive below as (
      select id from containers where id = ${ownerId}
      union all
      select c.id from containers c join below b on c.parent_id = b.id
    )
    select count(*)::int as count from tasks t
    where t.list_id in (select id from below)
      and t.custom_fields ? ${key}
      and (${optionIds ?? null}::text[] is null
           or t.custom_fields -> ${key} ?| ${optionIds ?? null}::text[]
           or t.custom_fields ->> ${key} = any(${optionIds ?? null}::text[]))`;
  return count;
}

export const fields: FastifyPluginAsyncTypebox = async (app) => {
  const { sql } = app;

  app.get("/v1/containers/:id/resolved-fields", { schema: { params: IdParams } }, async (req) => {
    await requireAccess(sql, req, req.params.id);
    return { data: (await resolvedFields(sql, req.params.id)).map(toApi) };
  });

  /** Definitions on this level only, including archived ones (so an admin can restore them). */
  app.get("/v1/containers/:id/fields", { schema: { params: IdParams } }, async (req) => {
    await requireAccess(sql, req, req.params.id);
    const data = await sql`
      select id, key, name, type, required, options, position, archived_at
      from field_definitions where owner_id = ${req.params.id}
      order by position`;
    return { data };
  });

  app.post(
    "/v1/containers/:id/fields",
    {
      schema: {
        params: IdParams,
        body: Type.Object(
          {
            key: Key,
            name: Name,
            type: FieldTypeSchema,
            required: Type.Optional(Type.Boolean()),
            options: Type.Optional(Options),
            ...AnchorProps,
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req, reply) => {
      requireAdmin(req);
      const ownerId = req.params.id;
      const { key, name, type, required = false, options } = req.body;
      checkOptions(type, options);

      const created = await sql.begin(async (tx) => {
        await lockConfig(tx);
        const [owner] = await tx<{ type: string }[]>`
          select type from containers where id = ${ownerId} and archived_at is null`;
        if (!owner) throw notFound("Container");
        await assertKeyFree(tx, ownerId, key);

        const position = placeAmong(await resolvedFields(tx, ownerId), req.body);
        const [row] = await tx`
          insert into field_definitions (owner_id, key, name, type, required, options, position)
          values (${ownerId}, ${key}, ${name}, ${type}, ${required},
                  ${options ? tx.json(options) : null}, ${position})
          returning id, key, name, type, required, options, position`;
        return row;
      });
      return reply.code(201).send(created);
    },
  );

  /**
   * Edit policy (docs/PLAN.md §0):
   *   name, required, order, new options, option labels → allowed (tasks store ids)
   *   type → 409 FIELD_TYPE_LOCKED (create a new field instead)
   *   remove an option that tasks use → 409 OPTION_IN_USE
   * shortcut: setting required: true does not backfill old tasks. They must get a value when they
   * move, and an update cannot clear it. Upgrade with a bulk-fill step if reports need complete data.
   */
  app.patch(
    "/v1/fields/:id",
    {
      schema: {
        params: IdParams,
        body: Type.Object(
          {
            name: Type.Optional(Name),
            type: Type.Optional(FieldTypeSchema),
            required: Type.Optional(Type.Boolean()),
            options: Type.Optional(Options),
            ...AnchorProps,
          },
          { additionalProperties: false, minProperties: 1 },
        ),
      },
    },
    async (req) => {
      requireAdmin(req);
      const { name, type, required, options, afterId, beforeId } = req.body;

      return sql.begin(async (tx) => {
        await lockConfig(tx);
        const [current] = await tx<(FieldDef & { ownerId: string; position: string })[]>`
          select owner_id, key, type, required, options, position from field_definitions
          where id = ${req.params.id} and archived_at is null`;
        if (!current) throw notFound("Field");

        if (type && type !== current.type) {
          throw conflict(
            "FIELD_TYPE_LOCKED",
            "The type of a field cannot change. Create a new field instead.",
          );
        }
        if (options) {
          checkOptions(current.type, options);
          const removed = current
            .options!.map((o) => o.id)
            .filter((id) => !options.some((o) => o.id === id));
          const used = removed.length
            ? await tasksUsing(tx, current.ownerId, current.key, removed)
            : 0;
          if (used > 0) {
            throw conflict("OPTION_IN_USE", `${used} task(s) still use the options you removed`, {
              options: removed,
              taskCount: used,
            });
          }
        }
        const position =
          afterId || beforeId
            ? placeAmong(
                (await resolvedFields(tx, current.ownerId)).filter((f) => f.id !== req.params.id),
                { afterId, beforeId },
              )
            : current.position;

        const [row] = await tx`
          update field_definitions set
            name = coalesce(${name ?? null}, name),
            required = coalesce(${required ?? null}, required),
            options = coalesce(${options ? tx.json(options) : null}, options),
            position = ${position}
          where id = ${req.params.id}
          returning id, key, name, type, required, options, position`;
        return row;
      });
    },
  );

  /** Archive. The values stay in tasks.custom_fields, and unarchive brings them back. */
  app.delete("/v1/fields/:id", { schema: { params: IdParams } }, async (req, reply) => {
    requireAdmin(req);
    const [row] = await sql`
      update field_definitions set archived_at = now()
      where id = ${req.params.id} and archived_at is null
      returning id`;
    if (!row) throw notFound("Field");
    return reply.code(204).send();
  });

  app.post("/v1/fields/:id/unarchive", { schema: { params: IdParams } }, async (req) => {
    requireAdmin(req);
    return sql.begin(async (tx) => {
      await lockConfig(tx);
      const [field] = await tx<{ ownerId: string; key: string }[]>`
        select owner_id, key from field_definitions where id = ${req.params.id} and archived_at is not null`;
      if (!field) throw notFound("Archived field");
      // Another level may have taken the key while this field was archived.
      await assertKeyFree(tx, field.ownerId, field.key, req.params.id);
      const [row] = await tx`
        update field_definitions set archived_at = null where id = ${req.params.id}
        returning id, key, name, type, required, options, position`;
      return row;
    });
  });
};
