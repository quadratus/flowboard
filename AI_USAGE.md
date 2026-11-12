# AI usage log

Tools: Claude (Opus) in the pi coding agent, Claude Code. I used them for design discussion, code generation and review. I read and checked every change before each commit.

## How I worked

1. **Design first, as a tutorial.** Before any code, I went through the data model with the AI one topic at a time (hierarchy, ordering, tasks, scoped statuses, custom fields, permissions). I rejected or changed several of its first proposals. The final decisions are in `docs/PLAN.md` §0.
2. **Build in phases.** Each phase ends with `vp check`, the tests, and one commit.

## Design decisions where I changed the AI's first answer

| Topic       | First proposal                           | Final decision    | Why                                                                                                                                                                 |
| ----------- | ---------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task status | `status_id uuid references statuses(id)` | `status_key text` | An override on a lower level is a new row with a new id. A task that stores the id loses its status when a folder overrides `done`. The key is the stable identity. |
| Table name  | `nodes`                                  | `containers`      | Matches the spec section title "Hierarchy (containers)".                                                                                                            |

## Corrections during the build

| Phase | What the AI produced                       | Problem                                                                    | Fix                                                                           |
| ----- | ------------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1     | Registered `ajv-formats` as an ajv plugin  | Type error, and Fastify already loads `ajv-formats` itself                 | Removed the plugin and the dependency                                         |
| 1     | `/v1/tree` sorted by `parent_id, position` | Sorting by a uuid does not put parents before children                     | Added a `depth` column to the recursive query and sorted by `depth, position` |
| 1     | Test used `ids.Workspace ?? ids.Flowboard` | `ids.Workspace` never exists; the test passed only because of the fallback | Used `ids.Flowboard` directly                                                 |
| 1     | `docker compose down -v` in a smoke check  | Also deleted the test database, so the next host test run failed           | The test helper creates `<db>_test` when it is missing                        |

## AI-generated tests I had to fix

See the `ids.Workspace` row above. More entries follow as later phases add tests.
