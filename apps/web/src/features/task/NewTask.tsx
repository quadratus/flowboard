import { useState } from "react";
import { ApiError } from "../../api/client.ts";
import { useCreateTask } from "../../api/queries.ts";
import type { Field, FieldValue, Issue, Status } from "../../api/types.ts";
import { ErrorNote } from "../../ui/ErrorNote.tsx";
import { FieldInput } from "./FieldInput.tsx";

/**
 * Quick create: title, column and the required fields only. The drawer opens after for the rest.
 * The form checks the title and required fields first, so one submit shows every missing value.
 * (The API stops at its body schema, so an empty title would hide the custom-field errors.)
 */
export function NewTask({
  listId,
  statuses,
  fields,
  onCreated,
  onClose,
}: {
  listId: string;
  statuses: Status[];
  fields: Field[];
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [statusKey, setStatusKey] = useState(statuses[0]?.key ?? "");
  const [values, setValues] = useState<Record<string, FieldValue | null>>({});
  const [local, setLocal] = useState<Issue[]>([]);
  const create = useCreateTask(listId);
  const required = fields.filter((f) => f.required);
  const issues = local.length ? local : create.error instanceof ApiError ? create.error.issues : [];
  const issueFor = (path: string) => issues.find((i) => i.path === path)?.issue;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const customFields = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null));
    const missing: Issue[] = [
      ...(title.trim() ? [] : [{ path: "title", issue: "Give the task a title." }]),
      ...required
        .filter((f) => customFields[f.key] === undefined)
        .map((f) => ({ path: `customFields.${f.key}`, issue: "is required" })),
    ];
    setLocal(missing);
    if (missing.length) return;
    create.mutate(
      { title, statusKey, customFields },
      {
        onSuccess: (task) => {
          onClose();
          onCreated(task.id);
        },
      },
    );
  }

  return (
    <form className="new-task" onSubmit={submit} noValidate aria-label="New task">
      <div className="field">
        <label htmlFor="new-title" className="field-label">
          Title
        </label>
        <input
          id="new-title"
          autoFocus
          value={title}
          maxLength={500}
          onChange={(e) => setTitle(e.target.value)}
        />
        {issues.find((i) => i.path === "title") ? (
          <p className="field-error">Give the task a title.</p>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="new-status" className="field-label">
          Column
        </label>
        <select id="new-status" value={statusKey} onChange={(e) => setStatusKey(e.target.value)}>
          {statuses.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      {required.map((f) => (
        <FieldInput
          key={f.key}
          field={f}
          value={values[f.key] ?? undefined}
          onChange={(v) => setValues({ ...values, [f.key]: v })}
          error={issueFor(`customFields.${f.key}`)}
        />
      ))}
      {create.error && issues.length === 0 ? <ErrorNote error={create.error} /> : null}
      <div className="row-actions">
        <button type="submit" className="primary-button" disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Create task"}
        </button>
        <button type="button" className="ghost-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
