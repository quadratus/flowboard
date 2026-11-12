import { useState } from "react";
import { NavLink, Outlet, useParams } from "react-router";
import { getUserHandle, setUserHandle } from "../api/client.ts";
import { useMe, useTree } from "../api/queries.ts";
import type { ContainerType } from "../api/types.ts";
import { buildTree, type TreeNode } from "../lib/tree.ts";
import { ErrorNote } from "../ui/ErrorNote.tsx";

const HANDLES = ["alice", "bob", "carol"] as const;

export function Shell() {
  return (
    <div className="shell">
      <Sidebar />
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}

function Sidebar() {
  const tree = useTree();
  return (
    <nav className="rail" aria-label="Workspace">
      <div className="rail-head">
        <span className="wordmark">Flowboard</span>
        <UserSwitcher />
      </div>
      {tree.error ? (
        <ErrorNote error={tree.error} tone="dark" />
      ) : (
        <ul className="tree" role="tree" data-testid="tree">
          {buildTree(tree.data ?? []).flatMap((ws) =>
            ws.children.map((n) => <Branch key={n.id} node={n} />),
          )}
        </ul>
      )}
    </nav>
  );
}

const LABEL: Record<ContainerType, string> = {
  workspace: "Workspace",
  space: "Space",
  folder: "Folder",
  list: "List",
};

function Branch({ node }: { node: TreeNode }) {
  const [open, setOpen] = useState(true);
  const { listId } = useParams();
  const hasChildren = node.children.length > 0;

  return (
    <li
      role="treeitem"
      aria-expanded={hasChildren ? open : undefined}
      className={`branch branch-${node.type}`}
    >
      <div className="branch-row">
        {node.type !== "list" ? (
          <button
            type="button"
            className="twisty"
            aria-label={`${open ? "Collapse" : "Expand"} ${node.name}`}
            onClick={() => setOpen(!open)}
            disabled={!hasChildren}
          >
            <span aria-hidden="true">{open ? "▾" : "▸"}</span>
          </button>
        ) : null}
        {node.type === "list" ? (
          <NavLink
            to={`/lists/${node.id}`}
            className={({ isActive }) =>
              `branch-link${isActive || listId === node.id ? " is-current" : ""}`
            }
          >
            {node.name}
          </NavLink>
        ) : (
          <span className="branch-name" title={LABEL[node.type]}>
            {node.name}
          </span>
        )}
        {node.isPrivate ? (
          <span className="private" title="Private: only people with access can see it">
            Private
          </span>
        ) : null}
      </div>
      {hasChildren && open ? (
        <ul role="group">
          {node.children.map((c) => (
            <Branch key={c.id} node={c} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Switches the mock identity. The server decides what that user can see. */
function UserSwitcher() {
  const me = useMe();
  const [handle, setHandle] = useState(getUserHandle());

  return (
    <label className="switcher">
      <span className="visually-hidden">Act as</span>
      <select
        data-testid="user-switcher"
        value={handle}
        onChange={(e) => {
          // A user switch is a new session, like a log out and log in: start the app again,
          // so no cached data or open drawer from the previous user survives.
          setUserHandle(e.target.value);
          setHandle(e.target.value);
          window.location.assign("/");
        }}
      >
        {HANDLES.map((h) => (
          <option key={h} value={h}>
            {h[0].toUpperCase() + h.slice(1)}
          </option>
        ))}
      </select>
      {me.data ? <span className="role">{me.data.role}</span> : null}
    </label>
  );
}
