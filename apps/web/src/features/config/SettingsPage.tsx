import { Link, useNavigate, useParams } from "react-router";
import { useMe, useTree } from "../../api/queries.ts";
import { pathTo } from "../../lib/tree.ts";
import { ErrorNote } from "../../ui/ErrorNote.tsx";
import { FieldEditor } from "./FieldEditor.tsx";
import { StatusEditor } from "./StatusEditor.tsx";

/**
 * Config for one level of the tree. The level switcher walks the path from the space to the
 * list the user came from, so it is easy to compare what each level adds.
 */
export function SettingsPage() {
  const { containerId = "" } = useParams();
  const navigate = useNavigate();
  const tree = useTree();
  const me = useMe();
  const flat = tree.data ?? [];
  const path = pathTo(flat, containerId);
  const here = path.at(-1);

  // The deepest list below or at this level, for the "back to board" link and the level switcher.
  const firstList =
    here?.type === "list"
      ? here
      : flat.find((c) => c.type === "list" && pathTo(flat, c.id).some((p) => p.id === containerId));
  const levels = firstList ? pathTo(flat, firstList.id) : path;

  if (me.data && me.data.role !== "admin") {
    return <ErrorNote error={new Error("Only an admin can change statuses and fields.")} />;
  }
  if (tree.isPending) return <p className="loading">Loading…</p>;
  if (!here) return <ErrorNote error={new Error("This level is not in your tree.")} />;

  return (
    <div className="settings">
      <header className="list-head">
        <div className="list-title-block">
          <p className="crumbs">Statuses and fields</p>
          <h1 className="list-title">
            {here.type === "workspace" ? "Workspace defaults" : here.name}
          </h1>
        </div>
        {firstList ? (
          <Link to={`/lists/${firstList.id}`} className="ghost-button">
            Back to {firstList.name}
          </Link>
        ) : null}
      </header>

      <nav className="levels" aria-label="Level">
        {levels.map((c, i) => (
          <button
            key={c.id}
            type="button"
            className={`level${c.id === containerId ? " is-current" : ""}`}
            aria-current={c.id === containerId ? "page" : undefined}
            onClick={() => void navigate(`/containers/${c.id}/settings`)}
          >
            <span className="level-kind">
              {["Workspace", "Space", "Folder", "List"][i] ?? c.type}
            </span>
            <span className="level-name">{c.type === "workspace" ? "Defaults" : c.name}</span>
          </button>
        ))}
      </nav>

      <p className="settings-intro">
        A level inherits every status and field from the levels to its left. Changes here apply to
        this level and every list below it.
      </p>

      <div className="settings-grid">
        <StatusEditor containerId={containerId} tree={flat} />
        <FieldEditor
          containerId={containerId}
          tree={flat}
          isWorkspace={here.type === "workspace"}
        />
      </div>
    </div>
  );
}
