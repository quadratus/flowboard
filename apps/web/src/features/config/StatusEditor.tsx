import { useState } from "react";
import { api, ApiError } from "../../api/client.ts";
import { useConfigMutation, useLocalStatuses, useStatuses } from "../../api/queries.ts";
import type { Category, Container, Status } from "../../api/types.ts";
import { ownerLabel } from "../../lib/tree.ts";
import { ErrorNote } from "../../ui/ErrorNote.tsx";

const CATEGORY_LABEL: Record<Category, string> = {
  not_started: "Not started",
  active: "Active",
  done: "Done",
  closed: "Closed",
};

/**
 * Shows the resolved set of this level and what each row means here:
 *   inherited (can override or hide), changed here (can reset), added here (can delete).
 * A removal that strands tasks returns 409; the editor then offers a column to move them to.
 */
export function StatusEditor({ containerId, tree }: { containerId: string; tree: Container[] }) {
  const resolved = useStatuses(containerId);
  const local = useLocalStatuses(containerId);
  // The parent's set tells an override (key exists above) from an addition (new key).
  const parentId = tree.find((c) => c.id === containerId)?.parentId ?? null;
  const parentSet = useStatuses(parentId);
  const parentKeys = new Set((parentSet.data ?? []).map((s) => s.key));
  const [editing, setEditing] = useState<string | null>(null);
  const [remap, setRemap] = useState<{
    action: (to: string) => Promise<unknown>;
    keys: string[];
    count: number;
  } | null>(null);

  const mutate = useConfigMutation((fn: () => Promise<unknown>) => fn());
  const run = (fn: (remapTo?: string) => Promise<unknown>) =>
    mutate.mutate(() => fn(), {
      onError: (e) => {
        if (e instanceof ApiError && e.code === "STATUS_IN_USE") {
          const d = e.details as { taskCount: number; statusKeys: string[] };
          setRemap({ action: (to) => fn(to), keys: d.statusKeys, count: d.taskCount });
        }
      },
      onSuccess: () => {
        setEditing(null);
        setRemap(null);
      },
    });

  const localByKey = new Map((local.data ?? []).map((s) => [s.key, s]));
  const hidden = (local.data ?? []).filter((s) => s.hidden);
  const q = (remapTo?: string) => (remapTo ? `?remapTo=${encodeURIComponent(remapTo)}` : "");

  return (
    <section className="panel" aria-labelledby="statuses-heading" data-testid="status-editor">
      <h2 id="statuses-heading" className="panel-title">
        Statuses
      </h2>
      <p className="panel-hint">
        These are the board columns for every list at or below this level.
      </p>

      {resolved.error ? <ErrorNote error={resolved.error} /> : null}
      <ol className="config-rows">
        {resolved.data?.map((s) => {
          const own = localByKey.get(s.key);
          const kind = s.inherited ? "inherited" : parentKeys.has(s.key) ? "changed" : "added";
          return (
            <li key={s.key} className="config-row">
              {editing === s.key ? (
                <StatusForm
                  initial={s}
                  submitLabel={s.inherited ? "Override here" : "Save"}
                  onCancel={() => setEditing(null)}
                  onSubmit={(v) =>
                    run(() =>
                      s.inherited
                        ? api("POST", `/containers/${containerId}/statuses`, { key: s.key, ...v })
                        : api("PATCH", `/statuses/${own!.id}`, v),
                    )
                  }
                />
              ) : (
                <>
                  <span className="lamp" style={{ background: s.color }} aria-hidden="true" />
                  <span className="config-name">{s.name}</span>
                  <span className="config-meta">{CATEGORY_LABEL[s.category]}</span>
                  <span className={`config-source source-${kind}`}>
                    {kind === "inherited"
                      ? ownerLabel(tree, s.ownerId, containerId)
                      : kind === "changed"
                        ? "changed here"
                        : "added here"}
                  </span>
                  <span className="config-actions">
                    <button type="button" className="link-button" onClick={() => setEditing(s.key)}>
                      {s.inherited ? "Override" : "Edit"}
                    </button>
                    {s.inherited ? (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() =>
                          run((to) =>
                            api("POST", `/containers/${containerId}/statuses${q(to)}`, {
                              key: s.key,
                              hidden: true,
                            }),
                          )
                        }
                      >
                        Hide
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => run((to) => api("DELETE", `/statuses/${own!.id}${q(to)}`))}
                      >
                        {kind === "changed" ? "Reset" : "Delete"}
                      </button>
                    )}
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>

      {hidden.length ? (
        <div className="hidden-rows">
          <h3 className="sub-title">Hidden at this level</h3>
          <ul>
            {hidden.map((h) => (
              <li key={h.id} className="config-row is-muted">
                <span className="config-name">{h.key}</span>
                <span className="config-actions">
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => run(() => api("DELETE", `/statuses/${h.id}`))}
                  >
                    Show again
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {remap ? (
        <RemapPrompt
          statuses={(resolved.data ?? []).filter((s) => !remap.keys.includes(s.key))}
          count={remap.count}
          onCancel={() => setRemap(null)}
          onConfirm={(to) => run(() => remap.action(to))}
        />
      ) : null}

      {editing === "__new" ? (
        <StatusForm
          submitLabel="Add status"
          withKey
          onCancel={() => setEditing(null)}
          onSubmit={(v) => run(() => api("POST", `/containers/${containerId}/statuses`, v))}
        />
      ) : (
        <button type="button" className="ghost-button" onClick={() => setEditing("__new")}>
          Add a status
        </button>
      )}

      {mutate.error &&
      !(mutate.error instanceof ApiError && mutate.error.code === "STATUS_IN_USE") ? (
        <ConfigError error={mutate.error} />
      ) : null}
    </section>
  );
}

type StatusValues = { key?: string; name: string; category: Category; color: string };

function StatusForm({
  initial,
  withKey,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Status;
  withKey?: boolean;
  submitLabel: string;
  onSubmit: (v: StatusValues) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState<Category>(initial?.category ?? "active");
  const [color, setColor] = useState(initial?.color ?? "#5b8a72");
  const key = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "s_$1")
    .slice(0, 40);

  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(withKey ? { key, name, category, color } : { name, category, color });
      }}
    >
      <label className="field">
        <span className="field-label">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={50}
          required
          autoFocus
        />
      </label>
      <label className="field">
        <span className="field-label">Category</span>
        <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="field field-color">
        <span className="field-label">Colour</span>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      </label>
      <div className="row-actions">
        <button
          type="submit"
          className="primary-button"
          disabled={!name.trim() || (withKey && !key)}
        >
          {submitLabel}
        </button>
        <button type="button" className="ghost-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function RemapPrompt({
  statuses,
  count,
  onConfirm,
  onCancel,
}: {
  statuses: Status[];
  count: number;
  onConfirm: (to: string) => void;
  onCancel: () => void;
}) {
  const [to, setTo] = useState(statuses[0]?.key ?? "");
  return (
    <div className="remap" role="alertdialog" aria-labelledby="remap-title">
      <h3 id="remap-title" className="sub-title">
        {count} {count === 1 ? "task uses" : "tasks use"} this status
      </h3>
      <p>
        Choose the column to move {count === 1 ? "it" : "them"} to. Nothing changes until you
        confirm.
      </p>
      <label className="field">
        <span className="field-label">Move tasks to</span>
        <select value={to} onChange={(e) => setTo(e.target.value)}>
          {statuses.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <div className="row-actions">
        <button
          type="button"
          className="primary-button"
          onClick={() => onConfirm(to)}
          disabled={!to}
        >
          Move tasks and remove
        </button>
        <button type="button" className="ghost-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Config errors carry structured details; show the part a user can act on. */
export function ConfigError({ error }: { error: unknown }) {
  if (error instanceof ApiError && error.code === "STATUS_SET_INCOMPLETE") {
    const broken = error.details as { name: string; missing: string[] }[];
    return (
      <div className="error-note error-note-light" role="alert">
        <strong>Every board needs a not started, an active and a done column.</strong>
        <ul>
          {broken.map((b) => (
            <li key={b.name}>
              {b.name} would have no {b.missing.map((m) => m.replace("_", " ")).join(" or ")}{" "}
              column.
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (error instanceof ApiError && error.code === "FIELD_KEY_COLLISION") {
    const d = error.details as { ownerName: string };
    return (
      <div className="error-note error-note-light" role="alert">
        <strong>A field with this name already exists on {d.ownerName}.</strong>
        <p>Lists below it already get that field. Choose another name.</p>
      </div>
    );
  }
  return <ErrorNote error={error} />;
}
