import { useState } from "react";
import type { Field, Status, Task, User } from "../../api/types.ts";
import { Avatars } from "../../ui/Avatars.tsx";
import { DueDate } from "../../ui/DueDate.tsx";
import { PriorityMark } from "../../ui/PriorityMark.tsx";
import { FieldDisplay } from "../task/FieldDisplay.tsx";

type Props = {
  tasks: Task[];
  statuses: Status[];
  fields: Field[];
  users: User[];
  onOpen: (id: string) => void;
};
type SortKey = "title" | "status" | "priority" | "dueDate" | `field:${string}`;

const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3, none: 4 } as const;

/**
 * Dense list of every task in the list. Sorts in the browser: the board query already holds
 * every task, so a server round trip adds nothing here. The API also sorts (?sort=) for other clients.
 */
export function TableView({ tasks, statuses, fields, users, onOpen }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "dueDate", dir: 1 });
  const [filter, setFilter] = useState<{ field: string; value: string } | null>(null);
  const statusRank = new Map(statuses.map((s, i) => [s.key, i]));
  const statusByKey = new Map(statuses.map((s) => [s.key, s]));
  const filterable = fields.filter((f) => f.type === "single_select" || f.type === "multi_select");

  const value = (t: Task, key: SortKey): string | number => {
    switch (key) {
      case "title":
        return t.title.toLowerCase();
      case "status":
        return statusRank.get(t.statusKey) ?? 99;
      case "priority":
        return PRIORITY_RANK[t.priority];
      case "dueDate":
        return t.dueDate ? Date.parse(t.dueDate) : Number.POSITIVE_INFINITY; // no date sorts last
      default: {
        const v = t.customFields[key.slice(6)];
        return Array.isArray(v) ? v.join(",") : typeof v === "number" ? v : String(v ?? "\uffff");
      }
    }
  };

  const rows = tasks
    .filter((t) => {
      if (!filter?.value) return true;
      const v = t.customFields[filter.field];
      return Array.isArray(v) ? v.includes(filter.value) : v === filter.value;
    })
    .toSorted((a, b) => {
      const x = value(a, sort.key);
      const y = value(b, sort.key);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || a.title.localeCompare(b.title);
    });

  const header = (key: SortKey, label: string, className = "") => {
    const active = sort.key === key;
    return (
      <th
        className={className}
        aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
      >
        <button
          type="button"
          className="th-sort"
          onClick={() => setSort({ key, dir: active ? (sort.dir === 1 ? -1 : 1) : 1 })}
        >
          {label}
          <span aria-hidden="true" className="th-arrow">
            {active ? (sort.dir === 1 ? "↑" : "↓") : ""}
          </span>
        </button>
      </th>
    );
  };

  const filterField = filterable.find((f) => f.key === filter?.field);

  return (
    <div className="table-view">
      {filterable.length ? (
        <div className="table-filter">
          <label>
            Filter by
            <select
              value={filter?.field ?? ""}
              onChange={(e) =>
                setFilter(e.target.value ? { field: e.target.value, value: "" } : null)
              }
            >
              <option value="">no field</option>
              {filterable.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          {filterField ? (
            <select
              aria-label={`${filterField.name} value`}
              value={filter?.value ?? ""}
              onChange={(e) => setFilter({ field: filterField.key, value: e.target.value })}
            >
              <option value="">any value</option>
              {filterField.options?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : null}
          <span className="table-count">
            {rows.length} of {tasks.length} tasks
          </span>
        </div>
      ) : null}

      <div className="table-scroll">
        <table className="task-table" data-testid="task-table">
          <thead>
            <tr>
              {header("title", "Title", "col-title")}
              {header("status", "Status")}
              <th>Assignees</th>
              {header("priority", "Priority")}
              {header("dueDate", "Due")}
              {fields.map((f) =>
                header(`field:${f.key}`, f.name, f.type === "number" ? "col-num" : ""),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const status = statusByKey.get(t.statusKey);
              return (
                <tr key={t.id} onClick={() => onOpen(t.id)}>
                  <td className="col-title">
                    <button type="button" className="row-open" onClick={() => onOpen(t.id)}>
                      {t.title}
                    </button>
                  </td>
                  <td>
                    <span className="status-pill">
                      <span
                        className="lamp"
                        style={{ background: status?.color }}
                        aria-hidden="true"
                      />
                      {status?.name ?? t.statusKey}
                    </span>
                  </td>
                  <td>
                    <Avatars ids={t.assigneeIds} users={users} />
                  </td>
                  <td>
                    <PriorityMark priority={t.priority} />
                  </td>
                  <td>{t.dueDate ? <DueDate iso={t.dueDate} /> : null}</td>
                  {fields.map((f) => (
                    <td key={f.key} className={f.type === "number" ? "col-num" : ""}>
                      <FieldDisplay field={f} value={t.customFields[f.key]} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="table-empty">No tasks match this filter.</p> : null}
      </div>
    </div>
  );
}
