import type { Priority } from "../api/types.ts";

export const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
  none: "No priority",
};

/** Bars like a signal strength meter: 4 for urgent, 0 for none. Text label for screen readers. */
const BARS: Record<Priority, number> = { urgent: 4, high: 3, normal: 2, low: 1, none: 0 };

export function PriorityMark({ priority }: { priority: Priority }) {
  if (priority === "none") return null;
  return (
    <span className={`priority priority-${priority}`} title={PRIORITY_LABEL[priority]}>
      <span className="bars" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <i key={n} className={n <= BARS[priority] ? "on" : ""} />
        ))}
      </span>
      <span className={priority === "urgent" ? "priority-text" : "visually-hidden"}>
        {PRIORITY_LABEL[priority]}
      </span>
    </span>
  );
}
