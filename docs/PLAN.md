# Flowboard build plan

Status: draft, 2026-11-13. Source: spec `flowboard.pdf` and the data-model sessions (topics 1–6).
Budget: about 4 days. Day 4 is the spec buffer.

## 0. Decisions already made

| Area            | Decision                                                                                                                                                                          | Topic  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Hierarchy       | One `containers` table (adjacency list) with `type`, `parent_id`, `is_private`, `archived_at`. The spec calls these "nodes".                                                      | 1      |
| Parent rules    | Workspace has no parent (DB `check`). Parent type (space→folder→list) is checked in the API.                                                                                      | 1      |
| Delete          | Containers: archive (`archived_at`). Tasks: hard delete + `cascade` on assignees.                                                                                                 | 1, 3   |
| Order           | Fractional index keys, `text collate "C"`, library `fractional-indexing`. Client sends `afterId`/`beforeId`, server computes the key.                                             | 2      |
| Assignees       | Join table `task_assignees`, not `uuid[]`.                                                                                                                                        | 3      |
| Statuses        | Merge by key, nearest level wins, `hidden` rows hide a key. Tasks store `status_key` (no FK).                                                                                     | 4a     |
| Status set rule | Every resolved set has not_started + active + done. Checked for every list under the owner, in the same transaction.                                                              | 4a     |
| Resolution      | SQL functions `ancestors(id)`, `resolved_statuses(list)`, `resolved_fields(list)`. Pick nearest row first, then filter hidden.                                                    | 4b, 5a |
| Field values    | `tasks.custom_fields jsonb`, values store option **ids**. Definitions in `field_definitions`.                                                                                     | 5a     |
| Field keys      | Collisions rejected up and down the tree (409). Config writes lock the workspace row (`for update`).                                                                              | 5a     |
| Validation      | API validates the merged final map, collects all errors, 400 with `details[].path = customFields.<key>`.                                                                          | 5b     |
| Move policy     | Keep the status if the key exists in the destination, else require `statusKey` in the body, else 400. Strip fields the destination does not define. Missing required field → 400. | 4a, 5b |
| In-use status   | Delete or hide → 409 with task count, unless `?remapTo=<key>`.                                                                                                                    | 4a     |
| Field changes   | Rename/add option: OK. Remove an in-use option: 409. Change type: 409. Delete: archive, values stay in `jsonb`.                                                                   | 5b     |
| Auth            | `X-User-Id: alice\|bob\|carol` → `onRequest` hook loads the user from the DB. 401 if missing or unknown.                                                                          | 6      |
| Permissions     | Path rule: no deny on the path, and every private container on the path has an allow. Admin bypasses. 403 when denied.                                                            | 6      |
| Config writes   | Statuses, fields, containers and grants: admin only.                                                                                                                              | 6      |

## 1. Backend plan

### 1.1 Module layout (modular monolith)

```
apps/api/
  migrations/                 001_core.sql … 004_tasks.sql (one file per phase)
  src/
    server.ts                 build app, register modules, listen
    app.ts                    buildApp() — used by server.ts and by tests (fastify.inject)
    db.ts                     postgres.js client
    migrate.ts                runner: schema_migrations table, advisory lock, one transaction per file
    seed.ts                   idempotent: skip if users exist
    shared/errors.ts          AppError + setErrorHandler → { error: { code, message, details? } }
    shared/pagination.ts      encode/decode cursor
    shared/position.ts        keyBetween(afterId, beforeId) using fractional-indexing
    modules/
      identity/               onRequest hook, GET /v1/me, GET /v1/users
      permissions/            canAccess(user, containerId), requireAdmin, grants routes
      hierarchy/              tree, container CRUD, move, archive
      statuses/               status CRUD, resolved-statuses, invariant checks
      fields/                 field CRUD, resolved-fields, validateCustomFields()
      tasks/                  task CRUD, list with cursor, move
  test/                       integration tests (real Postgres)
```

Rule: a module reads other modules only through their exported functions, not their tables. This gives the "service boundaries" story in the README.

### 1.2 Migrations (one per phase, so the history tells the story)

| File               | Content                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `001_core.sql`     | `users`, `containers`, `grants`, index `(parent_id, position) where archived_at is null` (partial unique), `ancestors()` |
| `002_statuses.sql` | `statuses`, `resolved_statuses()` (also returns `owner_id` as the source level)                                          |
| `003_fields.sql`   | `field_definitions`, `resolved_fields()`                                                                                 |
| `004_tasks.sql`    | `tasks`, `task_assignees`, index `(list_id, status_key, position)`                                                       |

Runner: on API start, `migrate.ts` runs first. It takes `pg_advisory_lock` so that two API replicas cannot migrate at the same time.
Compose: the api command becomes `node src/migrate.ts && node src/seed.ts && node src/server.ts`. The seed applies on first boot (spec §7).

### 1.3 Seed (spec §7)

```
Workspace "Flowboard"           statuses: todo, in_progress, done
├── Space "Engineering"         + in_review          fields: estimate (number, required), team (single_select)
│   └── Folder "Q2 Launch"      done → "Shipped"     fields: labels (multi_select)
│       ├── List A "Backlog"    hide in_review       8 tasks
│       └── List B "Sprint"     + blocked            fields: due_review (date)   8 tasks
└── Space "Leadership" PRIVATE                       fields: confidential (checkbox)
    └── Folder "Hiring"
        └── List C "Pipeline"                        5 tasks
Users:  alice (admin), bob (member), carol (member)
Grants: bob   deny  List B
        carol allow Leadership
```

Result: Bob sees Engineering, Q2 Launch, List A. Carol sees all containers through her allow on Leadership. Alice sees all because she is an admin.
Note: this changes the topic 6 example, so that Bob alone covers "private hidden" and "denied → 403".

### 1.4 API (REST, `/v1`)

| Method           | Path                                       | Notes                                                                                        |
| ---------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| GET              | `/v1/health`                               | exists                                                                                       |
| GET              | `/v1/me`, `/v1/users`                      | identity                                                                                     |
| GET              | `/v1/tree`                                 | visible containers, flat array, client builds the tree                                       |
| POST             | `/v1/containers`                           | admin; `{ parentId, type, name, isPrivate }`                                                 |
| PATCH            | `/v1/containers/:id`                       | admin; name, isPrivate                                                                       |
| POST             | `/v1/containers/:id/move`                  | admin; `{ parentId, afterId?, beforeId? }`, blocks moves into own subtree                    |
| POST             | `/v1/containers/:id/archive`, `/unarchive` | admin                                                                                        |
| GET/PUT/DELETE   | `/v1/containers/:id/grants/:userId`        | admin; seed covers the UI need                                                               |
| GET/POST         | `/v1/containers/:id/statuses`              | local rows; POST also creates overrides and `{ key, hidden: true }`                          |
| PATCH/DELETE     | `/v1/statuses/:id`                         | DELETE accepts `?remapTo=`                                                                   |
| GET              | `/v1/lists/:id/resolved-statuses`          | board columns + validator                                                                    |
| GET/POST         | `/v1/containers/:id/fields`                | local definitions                                                                            |
| PATCH/DELETE     | `/v1/fields/:id`                           | DELETE = archive                                                                             |
| GET              | `/v1/lists/:id/resolved-fields`            |                                                                                              |
| GET              | `/v1/lists/:id/tasks`                      | `?limit&cursor&sort=position\|dueDate\|priority` → `{ data, nextCursor }`                    |
| POST             | `/v1/lists/:id/tasks`                      | create                                                                                       |
| GET/PATCH/DELETE | `/v1/tasks/:id`                            | PATCH covers status change and reorder: `{ statusKey?, afterId?, beforeId?, customFields? }` |
| POST             | `/v1/tasks/:id/move`                       | cross-list: `{ listId, statusKey?, customFields?, afterId?, beforeId? }`                     |

API field name: `statusKey` (spec allows "stable statusKey"). Document it next to the spec test "unknown statusId".

### 1.5 Error codes

| HTTP | `code`                                                                       | When                                                                        |
| ---- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 400  | `VALIDATION_FAILED`                                                          | Body schema, status key, custom fields. `details: [{ path, issue }]`        |
| 400  | `STATUS_SET_INCOMPLETE`                                                      | A write leaves a list without not_started/active/done. `details` = list ids |
| 401  | `UNAUTHENTICATED`                                                            | No or unknown `X-User-Id`                                                   |
| 403  | `FORBIDDEN`                                                                  | Path rule fails, or a member calls an admin route                           |
| 404  | `NOT_FOUND`                                                                  | Missing or archived resource                                                |
| 409  | `STATUS_IN_USE`, `FIELD_KEY_COLLISION`, `FIELD_TYPE_LOCKED`, `OPTION_IN_USE` | Config conflicts                                                            |

Fastify body validation (built-in ajv, `additionalProperties: false`) maps `instancePath` to `details[].path`.

### 1.6 Patterns to reuse

1. **Write, verify, commit.** Config writes run in one transaction: lock workspace row → write → run invariant queries (category rule, orphan query) for lists under the owner → commit, or roll back and return 400/409.
2. **Access check before the read.** `preHandler` loads the target list (for task routes: `tasks.list_id`) and calls `canAccess`. A move checks the source and the destination.
3. **Keyset pagination.** `order by (sort_value, id)`, cursor = base64url `{ v, id }`. Priority sorts by `array_position(array['urgent','high','normal','low','none'], priority)`. Due date sorts with `coalesce(due_date, 'infinity')` so nulls go last and the cursor still works.
4. **Archived parents.** A container is active only if no container on its path is archived. `canAccess` checks this with `ancestors()`.

### 1.7 Backend tests (spec §8)

Tool: Vitest through `vp test`, `buildApp()` + `app.inject()`, real Postgres (`flowboard_test` database), migrate + seed before each file.

| Area              | Test                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Permissions       | Bob's tree has no Leadership; Alice's tree has all 3 lists; Bob `GET /v1/lists/B/tasks` → 403; no header → 401          |
| Status resolution | List A = todo, in_progress, done("Shipped"); List B = todo, in_progress, in_review, blocked, done                       |
| Status validation | Create and update with `statusKey: "nope"` → 400, path `statusKey`                                                      |
| Cross-list move   | B→A with `blocked` → 400; with `statusKey: "todo"` → 200 and status `todo`                                              |
| Custom fields     | `estimate: "five"` → 400; `team: "opt_xyz"` → 400; valid payload → 201                                                  |
| Required fields   | Create in List A without `estimate` → 400, path `customFields.estimate`                                                 |
| Config safety     | Delete in-use `in_review` → 409; with `remapTo=todo` → 200 and orphan query = 0 rows; hide in List B while in use → 409 |
| Unit              | `validateCustomFields`: one test per type row (topic 5b table)                                                          |

## 2. Frontend plan

### 2.1 Libraries (to confirm)

| Need                                      | Library                              | Why                                           |
| ----------------------------------------- | ------------------------------------ | --------------------------------------------- |
| Server state, cache, refetch after writes | `@tanstack/react-query`              | Removes hand-written loading/error/cache code |
| Drag and drop (columns + reorder)         | `@dnd-kit/core`, `@dnd-kit/sortable` | Accessible, works with React 19               |
| Routes                                    | `react-router`                       | List id and view live in the URL              |
| Styles                                    | Plain CSS (already in scaffold)      | Spec: clarity over pixel perfection           |
| E2E                                       | `@playwright/test`                   | Covers the required path and the bonus        |

### 2.2 Structure

```
apps/web/src/
  api/client.ts          fetch wrapper: adds X-User-Id, parses { error } into ApiError
  api/queries.ts         one hook per endpoint (useTree, useResolvedStatuses, useTasks, ...)
  app/Shell.tsx          header (UserSwitcher) + Sidebar + <Outlet/>
  app/UserSwitcher.tsx   alice|bob|carol in localStorage; on change: queryClient.clear()
  features/tree/Sidebar.tsx
  features/board/BoardView.tsx, Column.tsx, TaskCard.tsx
  features/table/TableView.tsx
  features/task/TaskDrawer.tsx, FieldInput.tsx   (one input per field type)
  features/config/StatusEditor.tsx, FieldEditor.tsx
```

Routes:

| Path                       | Screen                                            |
| -------------------------- | ------------------------------------------------- |
| `/lists/:id/board`         | Kanban (default)                                  |
| `/lists/:id/table`         | List view                                         |
| `/containers/:id/settings` | Status + field config for a space, folder or list |
| `?task=:taskId`            | Opens the task drawer on any list route           |

### 2.3 Screens and their API calls

| Screen                  | Reads                                                  | Writes                                                                                       |
| ----------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Sidebar                 | `/tree`                                                | none                                                                                         |
| Board                   | `resolved-statuses`, `tasks?sort=position`             | drag: `PATCH /tasks/:id { statusKey, afterId, beforeId }`, optimistic with rollback on error |
| Table                   | `resolved-fields`, `tasks?sort=dueDate\|priority`      | none; first 2 resolved fields become columns                                                 |
| Task drawer             | task, `resolved-statuses`, `resolved-fields`, `/users` | `PATCH /tasks/:id`; 400 `details[].path` shows under the matching input                      |
| Move dialog (in drawer) | destination `resolved-statuses`, `resolved-fields`     | `POST /tasks/:id/move`; lists the values that the move strips                                |
| Status editor           | `resolved-statuses` with source level                  | add, override, hide, delete; 409 opens a "remap to" select                                   |
| Field editor            | local fields                                           | add, edit, archive; 409 shows the conflict owner                                             |

Members see the settings link only for display; the API still returns 403 (server is the only trust boundary).

### 2.4 Frontend test

Playwright against the compose stack:

1. Required: select List B → see 5 columns → open a task → change `estimate` → save → value persists after reload.
2. Bonus: switch Alice → Bob → Leadership disappears from the sidebar.

Add `data-testid` attributes on columns, cards and field inputs.

## 3. Engineering deliverables (spec "Engineering expectations")

| Item            | Plan                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| System diagram  | Mermaid in README: browser → nginx → api (auth hook → permission check → modules) → Postgres; flow for "load board + drag card" |
| API docs        | `@fastify/swagger` + UI at `/docs` from route schemas (stretch 1); README table as fallback                                     |
| Multi-channel   | `docs/curl.md` cookbook + `task.updated` webhook payload example                                                                |
| Scale + IPC     | Design only: stateless API, outbox table → worker → activity/search. Say "single service, documented IPC plan" explicitly       |
| Index notes     | tree: `(parent_id, position)`; board: `(list_id, status_key, position)`; field filter: GIN on `custom_fields` when needed       |
| Tests in Docker | `make test`: start db, run api tests, run Playwright                                                                            |
| AI usage        | `AI_USAGE.md`, start now, add entries during each phase                                                                         |

Stretch goals (max 2): 1) OpenAPI + generated client (`openapi-typescript`), 2) filter by custom field (`custom_fields @> ...`).

## 4. Phases

| #   | Phase             | Output                                                                                                             | Time    |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------------------ | ------- |
| 1   | Schema foundation | `001_core.sql`, migrate runner, error handler, auth hook, `canAccess`, `/tree`, container routes, permission tests | 0.5 day |
| 2   | Statuses          | `002_statuses.sql`, status routes, invariant checks, resolution + config-safety tests                              | 0.5 day |
| 3   | Fields + tasks    | `003`, `004`, validator + unit tests, task CRUD, pagination, move, remaining spec tests, full seed                 | 1 day   |
| 4   | Frontend core     | client, shell, user switcher, sidebar, board with drag, table, task drawer                                         | 1 day   |
| 5   | Config UI + E2E   | status and field editors, move dialog, Playwright test                                                             | 0.5 day |
| 6   | Docs + demo       | README sections 1–9, diagram, curl cookbook, clean-clone check, 4–6 min video                                      | 0.5 day |

Each phase ends with `vp check`, the tests, and one commit (repo-local noreply identity).

## 5. Open questions

1. Confirm the frontend libraries in 2.1.
2. Confirm the seed grants in 1.3 (changed from the topic 6 example).
3. Confirm the 2 stretch goals.
