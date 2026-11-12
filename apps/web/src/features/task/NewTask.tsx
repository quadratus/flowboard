import { useState } from "react";
import { ApiError } from "../../api/client.ts";
import { useCreateTask } from "../../api/queries.ts";
import type { Field, FieldValue, Status } from "../../api/types.ts";
import { ErrorNote } from "../../ui/ErrorNote.tsx";
import { FieldInput } from "./FieldInput.tsx";

/** Quick create: title, column and the required fields only. The drawer opens after for the rest. */
export function NewTask({
  listId,
  statuses,
  fields,
  onCreated,
}: {
  listId: string;
  statuses: Status[];
  fields: Field[];
  onCreated: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [statusKey, setStatusKey] = useState(statuses[0]?.key ?? "");
  const [values, setValues] = useState<Record<string, FieldValue | null>>({});
  const create = useCreateTask(listId);
  const issues = create.error instanceof ApiError ? create.error.issues : [];
  const required = fields.filter((f) => f.required);

  if (!open) {
    return (
      <button type="button" className="primary-button" onClick={() => setOpen(true)}>
        New task
      </button>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const customFields = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null));
    create.mutate(
      { title, statusKey, customFields },
      {
        onSuccess: (task) => {
          setOpen(false);
          setTitle("");
          setValues({});
          create.reset();
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
          error={issues.find((i) => i.path === `customFields.${f.key}`)?.issue}
        />
      ))}
      {create.error && issues.length === 0 ? <ErrorNote error={create.error} /> : null}
      <div className="row-actions">
        <button type="submit" className="primary-button" disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Create task"}
        </button>
        <button type="button" className="ghost-button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
