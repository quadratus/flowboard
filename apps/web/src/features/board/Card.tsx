import type { Field, Task, User } from "../../api/types.ts";
import { Avatars } from "../../ui/Avatars.tsx";
import { DueDate } from "../../ui/DueDate.tsx";
import { PriorityMark } from "../../ui/PriorityMark.tsx";

/** One card. Title first; the metadata row only shows what is set. */
export function Card({
  task,
  users,
  badgeField,
  lifted,
}: {
  task: Task;
  users: User[];
  badgeField?: Field;
  lifted?: boolean;
}) {
  const badgeValue = badgeField ? task.customFields[badgeField.key] : undefined;
  const option = badgeField?.options?.find((o) => o.id === badgeValue);

  return (
    <article className={`card${lifted ? " is-lifted" : ""}`} data-testid="card">
      <h3 className="card-title">{task.title}</h3>
      <div className="card-meta">
        <PriorityMark priority={task.priority} />
        {task.dueDate ? <DueDate iso={task.dueDate} /> : null}
        {option ? (
          <span
            className="chip"
            style={{ "--chip": option.color ?? "#8a9690" } as React.CSSProperties}
          >
            {option.label}
          </span>
        ) : null}
        <Avatars ids={task.assigneeIds} users={users} />
      </div>
    </article>
  );
}
