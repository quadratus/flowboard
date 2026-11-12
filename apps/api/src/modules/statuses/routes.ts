import { Type, type FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { Queryable, Tx } from "../../db.ts";
import { AppError, conflict, invalid, notFound } from "../../shared/errors.ts";
import { placeAmong, type Anchor, type Sibling } from "../../shared/position.ts";
import { AnchorProps, IdParams } from "../../shared/schema.ts";
import { requireAccess, requireAdmin } from "../permissions/access.ts";
import { lockConfig } from "../../shared/locks.ts";

const Key = Type.String({ pattern: "^[a-z][a-z0-9_]{0,39}$" });
const Name = Type.String({ minLength: 1, maxLength: 50 });
const Category = Type.Union([
  Type.Literal("not_started"),
  Type.Literal("active"),
  Type.Literal("done"),
  Type.Literal("closed"),
]);
const Color = Type.String({ pattern: "^#[0-9a-f]{6}$" });

export type ResolvedStatus = {
  id: string;
  key: string;
  name: string;
  category: string;
  color: string;
  position: string;
  ownerId: string;
  depth: number;
};

/** The resolved set for a container (see migration 002). Callers check access first. */
export const resolvedStatuses = (sql: Queryable, containerId: string) =>
  sql<ResolvedStatus[]>`select * from resolved_statuses(${containerId})`;

const toApi = ({ depth, ...s }: ResolvedStatus) => ({ ...s, inherited: depth > 0 });

/**
 * Config safety (spec §3): a removal (delete or hide) can leave tasks on a status that their list
 * no longer has. Without remapTo → 409 STATUS_IN_USE and the write rolls back.
 * With remapTo → those tasks move to that key, which must exist in each of their lists.
 */
async function resolveOrphans(tx: Tx, ownerId: string, remapTo: string | undefined) {
  const orphans = await tx<{ taskId: string; listId: string; statusKey: string }[]>`
    select * from orphan_tasks(${ownerId})`;
  if (orphans.length === 0) return;
  if (!remapTo) {
    throw conflict(
      "STATUS_IN_USE",
      `${orphans.length} task(s) use this status. Send ?remapTo=<statusKey> to move them first.`,
      { taskCount: orphans.length, statusKeys: [...new Set(orphans.map((o) => o.statusKey))] },
    );
  }
  await tx`
    update tasks set status_key = ${remapTo}, updated_at = now()
    where id in ${tx(orphans.map((o) => o.taskId))}`;
  const left = await tx`select 1 from orphan_tasks(${ownerId}) limit 1`;
  if (left.length > 0) {
    throw invalid([
      { path: "query.remapTo", issue: `'${remapTo}' is not a status in every affected list` },
    ]);
  }
}

const RemapQuery = Type.Object({ remapTo: Type.Optional(Key) }, { additionalProperties: false });

/** Rolls the transaction back (by throwing) when a write leaves any set below `ownerId` incomplete. */
async function assertCompleteSets(tx: Tx, ownerId: string) {
  const broken = await tx<{ containerId: string; name: string; missing: string[] }[]>`
    select * from incomplete_status_sets(${ownerId})`;
  if (broken.length > 0) {
    throw new AppError(
      400,
      "STATUS_SET_INCOMPLETE",
      "Every status set needs at least one not_started, one active and one done status",
      broken,
    );
  }
}

/** Position for `key` in the set that `ownerId` resolves, from the anchors or a fallback. */
async function positionFor(
  tx: Tx,
  ownerId: string,
  key: string,
  anchor: Anchor,
  fallback: string | null,
) {
  if (!anchor.afterId && !anchor.beforeId && fallback) return fallback;
  const others: Sibling[] = (await resolvedStatuses(tx, ownerId)).filter((s) => s.key !== key);
  return placeAmong(others, anchor);
}

async function activeContainer(sql: Queryable, id: string) {
  const [c] = await sql<
    { id: string }[]
  >`select id from containers where id = ${id} and archived_at is null`;
  if (!c) throw notFound("Container");
}

export const statuses: FastifyPluginAsyncTypebox = async (app) => {
  const { sql } = app;

  /** Columns for a board. Works on any container, so the config UI can preview a folder. */
  app.get("/v1/containers/:id/resolved-statuses", { schema: { params: IdParams } }, async (req) => {
    await requireAccess(sql, req, req.params.id);
    return { data: (await resolvedStatuses(sql, req.params.id)).map(toApi) };
  });

  /** Rows defined on this level only: new statuses, overrides and hide rows. */
  app.get("/v1/containers/:id/statuses", { schema: { params: IdParams } }, async (req) => {
    await requireAccess(sql, req, req.params.id);
    const data = await sql`
      select id, key, hidden, name, category, color, position from statuses
      where owner_id = ${req.params.id}
      order by position nulls last, key`;
    return { data };
  });

  /**
   * One route for the 3 verbs of the model:
   *   - a key that no ancestor has   → add a status
   *   - a key that an ancestor has   → override it (name, category, color, order)
   *   - { key, hidden: true }        → hide the inherited key from this level down
   */
  app.post(
    "/v1/containers/:id/statuses",
    {
      schema: {
        params: IdParams,
        querystring: RemapQuery,
        body: Type.Union([
          Type.Object({ key: Key, hidden: Type.Literal(true) }, { additionalProperties: false }),
          Type.Object(
            { key: Key, name: Name, category: Category, color: Color, ...AnchorProps },
            { additionalProperties: false },
          ),
        ]),
      },
    },
    async (req, reply) => {
      requireAdmin(req);
      const ownerId = req.params.id;
      const body = req.body;

      const created = await sql.begin(async (tx) => {
        await lockConfig(tx);
        await activeContainer(tx, ownerId);

        const [taken] =
          await tx`select 1 from statuses where owner_id = ${ownerId} and key = ${body.key}`;
        if (taken) {
          throw conflict(
            "STATUS_KEY_EXISTS",
            `This level already has a row for '${body.key}'. Edit or delete that row.`,
          );
        }
        // The version that this level inherits, if any: the parent's resolved row for the key.
        const [inherited] = await tx<ResolvedStatus[]>`
          select r.* from containers c, resolved_statuses(c.parent_id) r
          where c.id = ${ownerId} and r.key = ${body.key}`;

        let row;
        if ("hidden" in body) {
          if (!inherited)
            throw invalid([
              {
                path: "key",
                issue: "no ancestor defines this status, so there is nothing to hide",
              },
            ]);
          [row] = await tx`
            insert into statuses (owner_id, key, hidden) values (${ownerId}, ${body.key}, true)
            returning id, key, hidden`;
        } else {
          // An override keeps the inherited place unless the request moves it.
          const position = await positionFor(
            tx,
            ownerId,
            body.key,
            body,
            inherited?.position ?? null,
          );
          [row] = await tx`
            insert into statuses (owner_id, key, name, category, color, position)
            values (${ownerId}, ${body.key}, ${body.name}, ${body.category}, ${body.color}, ${position})
            returning id, key, hidden, name, category, color, position`;
        }
        // Config errors (400) come before in-use conflicts (409): a broken set is never valid.
        await assertCompleteSets(tx, ownerId);
        if ("hidden" in body) await resolveOrphans(tx, ownerId, req.query.remapTo);
        return row;
      });
      return reply.code(201).send(created);
    },
  );

  app.patch(
    "/v1/statuses/:id",
    {
      schema: {
        params: IdParams,
        body: Type.Object(
          {
            name: Type.Optional(Name),
            category: Type.Optional(Category),
            color: Type.Optional(Color),
            ...AnchorProps,
          },
          { additionalProperties: false, minProperties: 1 },
        ),
      },
    },
    async (req) => {
      requireAdmin(req);
      const { name, category, color, afterId, beforeId } = req.body;

      return sql.begin(async (tx) => {
        await lockConfig(tx);
        const [current] = await tx<
          { ownerId: string; key: string; hidden: boolean; position: string }[]
        >`
          select owner_id, key, hidden, position from statuses where id = ${req.params.id}`;
        if (!current) throw notFound("Status");
        if (current.hidden)
          throw invalid([
            {
              path: "id",
              issue: "a hide row has nothing to edit; delete it to show the status again",
            },
          ]);

        const position = await positionFor(
          tx,
          current.ownerId,
          current.key,
          { afterId, beforeId },
          current.position,
        );
        const [row] = await tx`
          update statuses set
            name = coalesce(${name ?? null}, name),
            category = coalesce(${category ?? null}, category),
            color = coalesce(${color ?? null}, color),
            position = ${position}
          where id = ${req.params.id}
          returning id, key, hidden, name, category, color, position`;
        await assertCompleteSets(tx, current.ownerId);
        return row;
      });
    },
  );

  /**
   * Deletes one row on one level. The effect depends on the row:
   *   override → the inherited version comes back; hide row → the key shows again;
   *   new status → the key disappears from this subtree, so tasks on it need ?remapTo (else 409).
   */
  app.delete(
    "/v1/statuses/:id",
    { schema: { params: IdParams, querystring: RemapQuery } },
    async (req, reply) => {
      requireAdmin(req);
      await sql.begin(async (tx) => {
        await lockConfig(tx);
        const [row] = await tx<{ ownerId: string }[]>`
        delete from statuses where id = ${req.params.id} returning owner_id`;
        if (!row) throw notFound("Status");
        await assertCompleteSets(tx, row.ownerId);
        await resolveOrphans(tx, row.ownerId, req.query.remapTo);
      });
      return reply.code(204).send();
    },
  );
};
