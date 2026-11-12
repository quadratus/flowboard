import { Link, NavLink, useParams, useSearchParams } from "react-router";
import { useFields, useMe, useStatuses, useTasks, useTree, useUsers } from "../../api/queries.ts";
import { pathTo } from "../../lib/tree.ts";
import { ErrorNote } from "../../ui/ErrorNote.tsx";
import { Board } from "../board/Board.tsx";
import { TableView } from "../table/TableView.tsx";
import { TaskDrawer } from "../task/TaskDrawer.tsx";
import { NewTask } from "../task/NewTask.tsx";

export function ListPage() {
  const { listId = "", view = "board" } = useParams();
  const [params, setParams] = useSearchParams();
  const taskId = params.get("task");

  const tree = useTree();
  const me = useMe();
  const statuses = useStatuses(listId);
  const fields = useFields(listId);
  const tasks = useTasks(listId);
  const users = useUsers();

  const path = pathTo(tree.data ?? [], listId);
  const list = path.at(-1);
  const error = statuses.error ?? tasks.error ?? fields.error;

  const openTask = (id: string | null) =>
    setParams((p) => {
      if (id) p.set("task", id);
      else p.delete("task");
      return p;
    });

  return (
    <div className="list-page">
      <header className="list-head">
        <div className="list-title-block">
          <p className="crumbs">
            {path
              .slice(1, -1)
              .map((c) => c.name)
              .join(" / ")}
          </p>
          <h1 className="list-title" data-testid="list-title">
            {list?.name ?? " "}
          </h1>
        </div>
        <div className="list-tools">
          <nav className="views" aria-label="View">
            <NavLink to={`/lists/${listId}`} end className="view-tab">
              Board
            </NavLink>
            <NavLink to={`/lists/${listId}/table`} className="view-tab">
              Table
            </NavLink>
          </nav>
          {me.data?.role === "admin" ? (
            <Link to={`/containers/${listId}/settings`} className="ghost-button">
              Statuses and fields
            </Link>
          ) : null}
          {statuses.data && fields.data ? (
            <NewTask
              listId={listId}
              statuses={statuses.data}
              fields={fields.data}
              onCreated={openTask}
            />
          ) : null}
        </div>
      </header>

      {error ? (
        <ErrorNote error={error} />
      ) : statuses.data && tasks.data && fields.data ? (
        view === "table" ? (
          <TableView
            tasks={tasks.data}
            statuses={statuses.data}
            fields={fields.data}
            users={users.data ?? []}
            onOpen={openTask}
          />
        ) : (
          <Board
            listId={listId}
            tasks={tasks.data}
            statuses={statuses.data}
            fields={fields.data}
            users={users.data ?? []}
            tree={tree.data ?? []}
            onOpen={openTask}
          />
        )
      ) : (
        <p className="loading">Loading the list…</p>
      )}

      {taskId ? (
        <TaskDrawer key={taskId} taskId={taskId} listId={listId} onClose={() => openTask(null)} />
      ) : null}
    </div>
  );
}
