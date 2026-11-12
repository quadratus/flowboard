import { useState } from "react";
import { ApiError } from "../../api/client.ts";
import { useFields, useMoveTask, useStatuses, useTree } from "../../api/queries.ts";
import type { FieldValue, Task } from "../../api/types.ts";
import { pathTo } from "../../lib/tree.ts";
import { ErrorNote } from "../../ui/ErrorNote.tsx";
import { FieldInput } from "./FieldInput.tsx";

/**
 * Cross-list move with the server policy made visible before the user commits:
 * - the status: kept when the destination has it, else the user picks one;
 * - values for fields the destination lacks: listed as "will be removed";
 * - required fields of the destination that have no value: asked for here.
 */
export function MoveTask({ task, onDone }: { task: Task; onDone: () => void }) {
  const tree = useTree();
  const lists = (tree.data ?? []).filter((c) => c.type === "list" && c.id !== task.listId);
  const [listId, setListId] = useState("");

  return (
    <div className="move-panel" role="group" aria-label="Move task to another list">
      <h2 className="group-title">Move to another list</h2>
      <div className="field">
        <label htmlFor="move-list" className="field-label">
          Destination
        </label>
        <select id="move-list" value={listId} onChange={(e) => setListId(e.target.value)}>
          <option value="">Choose a list</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {pathTo(tree.data ?? [], l.id)
                .slice(1)
                .map((c) => c.name)
                .join(" / ")}
            </option>
          ))}
        </select>
      </div>
      {listId ? (
        <MovePlan key={listId} task={task} listId={listId} onDone={onDone} />
      ) : (
        <button type="button" className="ghost-button" onClick={onDone}>
          Cancel
        </button>
      )}
    </div>
  );
}

function MovePlan({ task, listId, onDone }: { task: Task; listId: string; onDone: () => void }) {
  const statuses = useStatuses(listId);
  const fields = useFields(listId);
  const move = useMoveTask(task.listId);
  const keeps = statuses.data?.some((s) => s.key === task.statusKey);
  const [statusKey, setStatusKey] = useState<string>("");
  const [values, setValues] = useState<Record<string, FieldValue | null>>({});

  if (statuses.error || fields.error) return <ErrorNote error={statuses.error ?? fields.error} />;
  if (!statuses.data || !fields.data) return <p className="loading">Checking the destination…</p>;

  const destKeys = new Set(fields.data.map((f) => f.key));
  const removed = Object.keys(task.customFields).filter((k) => !destKeys.has(k));
  const needed = fields.data.filter((f) => f.required && task.customFields[f.key] === undefined);
  const issues = move.error instanceof ApiError ? move.error.issues : [];

  function submit() {
    const customFields = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null));
    move.mutate(
      {
        id: task.id,
        listId,
        ...(statusKey ? { statusKey } : {}),
        ...(Object.keys(customFields).length ? { customFields } : {}),
      },
      { onSuccess: onDone },
    );
  }

  return (
    <div className="move-plan">
      <div className="field">
        <label htmlFor="move-status" className="field-label">
          Status in the destination
        </label>
        <select id="move-status" value={statusKey} onChange={(e) => setStatusKey(e.target.value)}>
          {keeps ? (
            <option value="">Keep the current status</option>
          ) : (
            <option value="">Choose a status</option>
          )}
          {statuses.data.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {removed.length ? (
        <p className="notice">
          The destination does not have {removed.length === 1 ? "this field" : "these fields"}, so
          the move removes {removed.length === 1 ? "its value" : "their values"}:{" "}
          <strong>{removed.join(", ")}</strong>.
        </p>
      ) : null}

      {needed.map((f) => (
        <FieldInput
          key={f.key}
          field={f}
          value={values[f.key] ?? undefined}
          onChange={(v) => setValues({ ...values, [f.key]: v })}
          error={issues.find((i) => i.path === `customFields.${f.key}`)?.issue}
          hint="The destination requires this field."
        />
      ))}

      {move.error && issues.length === 0 ? <ErrorNote error={move.error} /> : null}
      {issues.some((i) => i.path === "statusKey") ? (
        <p className="field-error">{issues.find((i) => i.path === "statusKey")?.issue}</p>
      ) : null}

      <div className="row-actions">
        <button
          type="button"
          className="primary-button"
          onClick={submit}
          disabled={move.isPending || (!keeps && !statusKey)}
        >
          {move.isPending ? "Moving…" : "Move task"}
        </button>
        <button type="button" className="ghost-button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
