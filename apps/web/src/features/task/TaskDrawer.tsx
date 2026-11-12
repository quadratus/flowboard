import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client.ts";
import {
  useDeleteTask,
  useFields,
  useStatuses,
  useTask,
  useTree,
  useUpdateTask,
  useUsers,
  type TaskPatch,
} from "../../api/queries.ts";
import type { FieldValue, Priority, Task } from "../../api/types.ts";
import { ownerLabel } from "../../lib/tree.ts";
import { ErrorNote } from "../../ui/ErrorNote.tsx";
import { PRIORITY_LABEL } from "../../ui/PriorityMark.tsx";
import { FieldInput } from "./FieldInput.tsx";
import { MoveTask } from "./MoveTask.tsx";

type Props = { taskId: string; listId: string; onClose: () => void };

/** Side panel for one task: built-in fields and the resolved custom fields of its list. */
export function TaskDrawer({ taskId, listId, onClose }: Props) {
  const task = useTask(taskId);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <aside
        ref={panel}
        tabIndex={-1}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Task details"
        data-testid="task-drawer"
      >
        {task.error ? (
          <div className="drawer-body">
            <ErrorNote error={task.error} />
            <button type="button" className="ghost-button" onClick={onClose}>
              Close
            </button>
          </div>
        ) : task.data ? (
          // Remount only when the task moves to another list (new statuses and fields). A save
          // keeps the form, so "Saved" stays visible and the draft already matches the server.
          <TaskForm key={task.data.listId} task={task.data} pageListId={listId} onClose={onClose} />
        ) : (
          <p className="loading drawer-body">Loading the task…</p>
        )}
      </aside>
    </>
  );
}

type Draft = {
  title: string;
  description: string;
  statusKey: string;
  priority: Priority;
  dueDate: string; // yyyy-mm-dd for the date input
  assigneeIds: string[];
  customFields: Record<string, FieldValue | null>;
};

const toDraft = (t: Task): Draft => ({
  title: t.title,
  description: t.description ?? "",
  statusKey: t.statusKey,
  priority: t.priority,
  dueDate: t.dueDate ? t.dueDate.slice(0, 10) : "",
  assigneeIds: t.assigneeIds,
  customFields: { ...t.customFields },
});

/** Only changed values go in the PATCH, so two people editing different fields do not collide. */
function diff(task: Task, d: Draft): TaskPatch {
  const p: TaskPatch = {};
  if (d.title !== task.title) p.title = d.title;
  if (d.description !== (task.description ?? "")) p.description = d.description || null;
  if (d.statusKey !== task.statusKey) p.statusKey = d.statusKey;
  if (d.priority !== task.priority) p.priority = d.priority;
  const due = task.dueDate ? task.dueDate.slice(0, 10) : "";
  if (d.dueDate !== due)
    p.dueDate = d.dueDate ? new Date(`${d.dueDate}T12:00:00Z`).toISOString() : null;
  if (d.assigneeIds.join() !== task.assigneeIds.join()) p.assigneeIds = d.assigneeIds;
  const cf: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d.customFields)) {
    if (JSON.stringify(v ?? null) !== JSON.stringify(task.customFields[k] ?? null)) cf[k] = v;
  }
  if (Object.keys(cf).length) p.customFields = cf;
  return p;
}

function TaskForm({
  task,
  pageListId,
  onClose,
}: {
  task: Task;
  pageListId: string;
  onClose: () => void;
}) {
  const statuses = useStatuses(task.listId);
  const fields = useFields(task.listId);
  const users = useUsers();
  const tree = useTree();
  const update = useUpdateTask(task.listId);
  const remove = useDeleteTask(task.listId);
  const [draft, setDraft] = useState(() => toDraft(task));
  const [saved, setSaved] = useState(false);
  const [moving, setMoving] = useState(false);

  const patch = diff(task, draft);
  const dirty = Object.keys(patch).length > 0;
  const issues = update.error instanceof ApiError ? update.error.issues : [];
  const issueFor = (path: string) => issues.find((i) => i.path === path)?.issue;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [k]: v }));
  };

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    update.mutate({ id: task.id, patch }, { onSuccess: () => setSaved(true) });
  }

  return (
    <form className="task-form" onSubmit={save} noValidate>
      <div className="drawer-head">
        <label htmlFor="task-title" className="visually-hidden">
          Title
        </label>
        <textarea
          id="task-title"
          className="title-input"
          rows={2}
          maxLength={500}
          value={draft.title}
          onChange={(e) => set("title", e.target.value)}
          aria-invalid={issueFor("title") ? true : undefined}
        />
        <button type="button" className="close" onClick={onClose} aria-label="Close task">
          ×
        </button>
      </div>

      <div className="drawer-body">
        {task.listId !== pageListId ? (
          <p className="notice">
            This task now lives in another list. Its fields follow that list.
          </p>
        ) : null}

        <section className="field-group" aria-label="Built-in fields">
          <div className="field">
            <label htmlFor="task-status" className="field-label">
              Status
            </label>
            <select
              id="task-status"
              data-testid="task-status"
              value={draft.statusKey}
              onChange={(e) => set("statusKey", e.target.value)}
            >
              {statuses.data?.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
            </select>
            {issueFor("statusKey") ? <p className="field-error">{issueFor("statusKey")}</p> : null}
          </div>

          <div className="field">
            <label htmlFor="task-priority" className="field-label">
              Priority
            </label>
            <select
              id="task-priority"
              value={draft.priority}
              onChange={(e) => set("priority", e.target.value as Priority)}
            >
              {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="task-due" className="field-label">
              Due date
            </label>
            <input
              id="task-due"
              type="date"
              value={draft.dueDate}
              onChange={(e) => set("dueDate", e.target.value)}
            />
          </div>

          <fieldset className="field">
            <legend className="field-label">Assignees</legend>
            <div className="option-set">
              {users.data?.map((u) => {
                const on = draft.assigneeIds.includes(u.id);
                return (
                  <label key={u.id} className={`option-toggle${on ? " is-on" : ""}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        set(
                          "assigneeIds",
                          on
                            ? draft.assigneeIds.filter((x) => x !== u.id)
                            : [...draft.assigneeIds, u.id],
                        )
                      }
                    />
                    {u.name.split(" ")[0]}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="field field-wide">
            <label htmlFor="task-description" className="field-label">
              Description
            </label>
            <textarea
              id="task-description"
              rows={4}
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>
        </section>

        <section className="field-group" aria-labelledby="custom-heading">
          <h2 id="custom-heading" className="group-title">
            Fields for this list
          </h2>
          {fields.data?.length === 0 ? (
            <p className="field-hint">This list has no custom fields.</p>
          ) : null}
          {fields.data?.map((f) => (
            <FieldInput
              key={f.key}
              field={f}
              value={draft.customFields[f.key] ?? undefined}
              onChange={(v) => set("customFields", { ...draft.customFields, [f.key]: v })}
              error={issueFor(`customFields.${f.key}`)}
              hint={ownerLabel(tree.data ?? [], f.ownerId, task.listId)}
            />
          ))}
        </section>

        {update.error && issues.length === 0 ? <ErrorNote error={update.error} /> : null}
        {remove.error ? <ErrorNote error={remove.error} /> : null}
      </div>

      <footer className="drawer-foot">
        <button
          type="submit"
          className="primary-button"
          disabled={!dirty || update.isPending}
          data-testid="save-task"
        >
          {update.isPending ? "Saving…" : "Save changes"}
        </button>
        <span className="save-state" role="status">
          {saved && !dirty ? "Saved" : dirty ? "Unsaved changes" : ""}
        </span>
        <span className="foot-spacer" />
        <button type="button" className="ghost-button" onClick={() => setMoving(true)}>
          Move to list
        </button>
        <button
          type="button"
          className="ghost-button danger"
          onClick={() => {
            if (window.confirm(`Delete "${task.title}"? This cannot be undone.`)) {
              remove.mutate(task.id, { onSuccess: onClose });
            }
          }}
        >
          Delete
        </button>
      </footer>

      {moving ? <MoveTask task={task} onDone={() => setMoving(false)} /> : null}
    </form>
  );
}
