import { Type, type FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyRequest } from "fastify";
import type { Queryable, Sql, Tx } from "../../db.ts";
import { invalid, notFound, type Issue } from "../../shared/errors.ts";
import { lockForTaskWrite } from "../../shared/locks.ts";
import { decodeCursor, encodeCursor } from "../../shared/pagination.ts";
import { placeAmong } from "../../shared/position.ts";
import { AnchorProps, Id, IdParams } from "../../shared/schema.ts";
import { resolvedFields } from "../fields/routes.ts";
import {
  mergeValues,
  stripUnknown,
  validateCustomFields,
  type FieldValues,
} from "../fields/validate.ts";
import { requireAccess } from "../permissions/access.ts";
import { resolvedStatuses } from "../statuses/routes.ts";

const Priority = Type.Union([
  Type.Literal("urgent"),
  Type.Literal("high"),
  Type.Literal("normal"),
  Type.Literal("low"),
  Type.Literal("none"),
]);
const Title = Type.String({ minLength: 1, maxLength: 500 });
const Description = Type.Union([Type.String({ maxLength: 20000 }), Type.Null()]);
const DueDate = Type.Union([Type.String({ format: "date-time" }), Type.Null()]);
const StatusKey = Type.String({ minLength: 1, maxLength: 40 });
const Assignees = Type.Array(Id, { maxItems: 20, uniqueItems: true });
const CustomFields = Type.Record(Type.String(), Type.Unknown());

const taskColumns = (sql: Queryable) => sql`
  t.id, t.list_id, t.status_key, t.title, t.description, t.priority, t.due_date,
  t.custom_fields, t.position, t.created_at, t.updated_at,
  coalesce((select array_agg(a.user_id order by a.user_id) from task_assignees a where a.task_id = t.id),
           '{}') as assignee_ids`;

type TaskRow = {
  id: string;
  listId: string;
  statusKey: string;
  customFields: FieldValues;
  position: string;
};

async function loadTask(sql: Queryable, id: string) {
  const [task] = await sql`select ${taskColumns(sql)} from tasks t where t.id = ${id}`;
  return task;
}

/** The task's list decides access: a task is visible when its list is. */
async function taskForUser(sql: Sql, req: FastifyRequest, id: string): Promise<TaskRow> {
  const [task] = await sql<TaskRow[]>`
    select id, list_id, status_key, custom_fields, position from tasks where id = ${id}`;
  if (!task) throw notFound("Task");
  await requireAccess(sql, req, task.listId, "Task");
  return task;
}

async function requireList(sql: Sql, req: FastifyRequest, id: string) {
  await requireAccess(sql, req, id, "List");
  const [c] = await sql<{ type: string }[]>`select type from containers where id = ${id}`;
  if (c.type !== "list")
    throw invalid([{ path: "listId", issue: `tasks live in lists, not in a ${c.type}` }]);
}

/** Collects status and custom-field issues for a task in `listId`, then throws one 400 with all of them. */
async function validateTask(
  tx: Tx,
  listId: string,
  statusKey: string,
  values: FieldValues,
  extra: Issue[] = [],
) {
  const [statuses, fields] = await Promise.all([
    resolvedStatuses(tx, listId),
    resolvedFields(tx, listId),
  ]);
  const issues = [...extra];
  if (!issues.some((i) => i.path === "statusKey") && !statuses.some((s) => s.key === statusKey)) {
    issues.push({
      path: "statusKey",
      issue: `'${statusKey}' is not a status of this list. Valid: ${statuses.map((s) => s.key).join(", ")}`,
    });
  }
  issues.push(...validateCustomFields(fields, values));
  if (issues.length) throw invalid(issues);
  return fields;
}

const columnTasks = (tx: Tx, listId: string, statusKey: string, excludeId: string | null) => tx<
  { id: string; position: string }[]
>`
  select id, position from tasks
  where list_id = ${listId} and status_key = ${statusKey} and id is distinct from ${excludeId}
  order by position, id`;

async function setAssignees(tx: Tx, taskId: string, userIds: string[] | undefined) {
  if (!userIds) return;
  const known = userIds.length ? await tx`select id from users where id in ${tx(userIds)}` : [];
  if (known.length !== userIds.length) {
    throw invalid([{ path: "assigneeIds", issue: "contains an unknown user id" }]);
  }
  await tx`delete from task_assignees where task_id = ${taskId}`;
  if (userIds.length) {
    await tx`insert into task_assignees ${tx(userIds.map((userId) => ({ taskId, userId })))}`;
  }
}

/** Sort options for the list view. Each maps to one sortable SQL expression plus id as tie-break. */
const SORTS = {
  position: { expr: "t.status_key || ':' || t.position", type: "text" },
  dueDate: { expr: "coalesce(t.due_date, 'infinity'::timestamptz)", type: "timestamptz" },
  priority: {
    expr: "array_position(array['urgent','high','normal','low','none'], t.priority)",
    type: "int",
  },
  title: { expr: "lower(t.title)", type: "text" },
} as const;

export const tasks: FastifyPluginAsyncTypebox = async (app) => {
  const { sql } = app;

  /**
   * Tasks of one list with keyset pagination: { data, nextCursor }.
   * Filters: status, and one custom field equality (stretch: filter by custom field).
   */
  app.get(
    "/v1/lists/:id/tasks",
    {
      schema: {
        params: IdParams,
        querystring: Type.Object(
          {
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
            cursor: Type.Optional(Type.String()),
            sort: Type.Optional(Type.Union(Object.keys(SORTS).map((k) => Type.Literal(k)))),
            order: Type.Optional(Type.Union([Type.Literal("asc"), Type.Literal("desc")])),
            statusKey: Type.Optional(StatusKey),
            fieldKey: Type.Optional(Type.String({ pattern: "^[a-z][a-z0-9_]{0,39}$" })),
            fieldValue: Type.Optional(Type.String({ maxLength: 200 })),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req) => {
      await requireList(sql, req, req.params.id);
      const {
        limit = 50,
        sort = "position",
        order = "asc",
        statusKey,
        fieldKey,
        fieldValue,
      } = req.query;
      const cursor = decodeCursor(req.query.cursor);
      const { expr, type } = SORTS[sort as keyof typeof SORTS];
      const sortExpr = sql.unsafe(expr); // from the fixed SORTS map, never from the request
      const dir = sql.unsafe(order === "desc" ? "desc" : "asc");
      const cmp = sql.unsafe(order === "desc" ? "<" : ">");

      // A field filter matches a scalar value or one item of a multi_select array.
      const fieldFilter =
        fieldKey && fieldValue !== undefined
          ? sql`and (t.custom_fields -> ${fieldKey} = to_jsonb(${fieldValue}::text)
                 or t.custom_fields -> ${fieldKey} @> to_jsonb(array[${fieldValue}::text])
                 or (t.custom_fields ->> ${fieldKey}) = ${fieldValue})`
          : sql``;

      const rows = await sql<
        (Record<string, unknown> & { id: string; sortValue: string | number | Date })[]
      >`
        select ${taskColumns(sql)}, ${sortExpr} as sort_value
        from tasks t
        where t.list_id = ${req.params.id}
          ${statusKey ? sql`and t.status_key = ${statusKey}` : sql``}
          ${fieldFilter}
          ${
            cursor
              ? sql`and (${sortExpr}, t.id) ${cmp} (${cursor.v}::${sql.unsafe(type)}, ${cursor.id}::uuid)`
              : sql``
          }
        order by ${sortExpr} ${dir}, t.id ${dir}
        limit ${limit + 1}`;

      const page = rows.slice(0, limit);
      const last = page.at(-1);
      const nextCursor =
        rows.length > limit && last
          ? encodeCursor({
              v: last.sortValue instanceof Date ? last.sortValue.toISOString() : last.sortValue,
              id: last.id,
            })
          : null;
      for (const row of page) delete (row as { sortValue?: unknown }).sortValue;
      return { data: page, nextCursor };
    },
  );

  app.post(
    "/v1/lists/:id/tasks",
    {
      schema: {
        params: IdParams,
        body: Type.Object(
          {
            title: Title,
            statusKey: StatusKey,
            description: Type.Optional(Description),
            priority: Type.Optional(Priority),
            dueDate: Type.Optional(DueDate),
            assigneeIds: Type.Optional(Assignees),
            customFields: Type.Optional(CustomFields),
            ...AnchorProps,
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req, reply) => {
      const listId = req.params.id;
      await requireList(sql, req, listId);
      const b = req.body;
      const values = mergeValues({}, b.customFields);

      const id = await sql.begin(async (tx) => {
        await lockForTaskWrite(tx);
        await validateTask(tx, listId, b.statusKey, values);
        const position = placeAmong(await columnTasks(tx, listId, b.statusKey, null), b);
        const [row] = await tx<{ id: string }[]>`
          insert into tasks (list_id, status_key, title, description, priority, due_date, custom_fields, position)
          values (${listId}, ${b.statusKey}, ${b.title}, ${b.description ?? null}, ${b.priority ?? "none"},
                  ${b.dueDate ?? null}, ${tx.json(values as never)}, ${position})
          returning id`;
        await setAssignees(tx, row.id, b.assigneeIds);
        return row.id;
      });
      return reply.code(201).send(await loadTask(sql, id));
    },
  );

  app.get("/v1/tasks/:id", { schema: { params: IdParams } }, async (req) => {
    await taskForUser(sql, req, req.params.id);
    return loadTask(sql, req.params.id);
  });

  /**
   * Update inside the same list. Covers the board actions too:
   *   statusKey → move to another column; afterId/beforeId → reorder inside the column.
   * customFields is a patch: keys set to null are cleared, other keys stay.
   */
  app.patch(
    "/v1/tasks/:id",
    {
      schema: {
        params: IdParams,
        body: Type.Object(
          {
            title: Type.Optional(Title),
            statusKey: Type.Optional(StatusKey),
            description: Type.Optional(Description),
            priority: Type.Optional(Priority),
            dueDate: Type.Optional(DueDate),
            assigneeIds: Type.Optional(Assignees),
            customFields: Type.Optional(CustomFields),
            ...AnchorProps,
          },
          { additionalProperties: false, minProperties: 1 },
        ),
      },
    },
    async (req) => {
      const b = req.body;
      await sql.begin(async (tx) => {
        await lockForTaskWrite(tx);
        const current = await taskForUser(sql, req, req.params.id);
        const [locked] = await tx<TaskRow[]>`
          select list_id, status_key, custom_fields, position from tasks where id = ${req.params.id} for update`;
        const statusKey = b.statusKey ?? locked.statusKey;
        const values = mergeValues(locked.customFields, b.customFields);
        await validateTask(tx, current.listId, statusKey, values);

        const moved = statusKey !== locked.statusKey || b.afterId || b.beforeId;
        const position = moved
          ? placeAmong(await columnTasks(tx, current.listId, statusKey, req.params.id), b)
          : locked.position;
        await tx`
          update tasks set
            title = coalesce(${b.title ?? null}, title),
            description = ${b.description === undefined ? tx`description` : b.description},
            priority = coalesce(${b.priority ?? null}, priority),
            due_date = ${b.dueDate === undefined ? tx`due_date` : b.dueDate},
            status_key = ${statusKey},
            custom_fields = ${tx.json(values as never)},
            position = ${position},
            updated_at = now()
          where id = ${req.params.id}`;
        await setAssignees(tx, req.params.id, b.assigneeIds);
      });
      return loadTask(sql, req.params.id);
    },
  );

  /**
   * Cross-list move (spec §2, hard cases in §3 and §4). Policy:
   *   status: keep the key if the destination has it; else the body must name one; else 400.
   *   fields: drop values the destination does not define (listed in the response),
   *           then merge body.customFields, then validate. A missing required field is a 400.
   * The caller needs access to both lists.
   */
  app.post(
    "/v1/tasks/:id/move",
    {
      schema: {
        params: IdParams,
        body: Type.Object(
          {
            listId: Id,
            statusKey: Type.Optional(StatusKey),
            customFields: Type.Optional(CustomFields),
            ...AnchorProps,
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req) => {
      const b = req.body;
      const current = await taskForUser(sql, req, req.params.id);
      await requireList(sql, req, b.listId);

      const stripped = await sql.begin(async (tx) => {
        await lockForTaskWrite(tx);
        const [locked] = await tx<TaskRow[]>`
          select status_key, custom_fields from tasks where id = ${req.params.id} for update`;
        const destStatuses = await resolvedStatuses(tx, b.listId);
        const keepStatus = destStatuses.some((s) => s.key === locked.statusKey);

        const extra: Issue[] = [];
        if (!b.statusKey && !keepStatus) {
          extra.push({
            path: "statusKey",
            issue: `the destination has no '${locked.statusKey}' status; choose one of: ${destStatuses.map((s) => s.key).join(", ")}`,
          });
        }
        const statusKey = b.statusKey ?? locked.statusKey;
        const { kept, stripped } = stripUnknown(
          await resolvedFields(tx, b.listId),
          locked.customFields,
        );
        const values = mergeValues(kept, b.customFields);
        await validateTask(tx, b.listId, statusKey, values, extra);

        const position = placeAmong(await columnTasks(tx, b.listId, statusKey, req.params.id), b);
        await tx`
          update tasks set list_id = ${b.listId}, status_key = ${statusKey},
            custom_fields = ${tx.json(values as never)}, position = ${position}, updated_at = now()
          where id = ${req.params.id}`;
        return stripped;
      });
      return {
        ...(await loadTask(sql, req.params.id)),
        strippedFields: stripped,
        fromListId: current.listId,
      };
    },
  );

  app.delete("/v1/tasks/:id", { schema: { params: IdParams } }, async (req, reply) => {
    await taskForUser(sql, req, req.params.id);
    await sql`delete from tasks where id = ${req.params.id}`;
    return reply.code(204).send();
  });
};
