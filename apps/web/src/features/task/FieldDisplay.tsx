import type { Field, FieldValue } from "../../api/types.ts";

/** Read-only value of one custom field, for table cells. Empty values render nothing. */
export function FieldDisplay({ field, value }: { field: Field; value: FieldValue | undefined }) {
  if (value === undefined || value === null || value === "") return null;
  switch (field.type) {
    case "checkbox":
      return <span>{value ? "Yes" : "No"}</span>;
    case "single_select":
    case "multi_select": {
      const ids = Array.isArray(value) ? value : [String(value)];
      return (
        <span className="chips">
          {ids.map((id) => {
            const o = field.options?.find((x) => x.id === id);
            return (
              <span
                key={id}
                className="chip"
                style={{ "--chip": o?.color ?? "#8a9690" } as React.CSSProperties}
              >
                {o?.label ?? id}
              </span>
            );
          })}
        </span>
      );
    }
    case "date":
      return <time dateTime={String(value)}>{String(value)}</time>;
    default:
      return <span>{String(value)}</span>;
  }
}
