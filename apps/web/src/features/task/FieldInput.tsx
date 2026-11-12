import type { Field, FieldValue } from "../../api/types.ts";

type Props = {
  field: Field;
  value: FieldValue | undefined;
  onChange: (value: FieldValue | null) => void;
  error?: string;
  hint?: string;
};

/**
 * One input per field type. It sends the JSON type the API expects (number, boolean, option ids),
 * and null to clear a value. The API still validates everything.
 */
export function FieldInput({ field, value, onChange, error, hint }: Props) {
  const id = `field-${field.key}`;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const common = {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    "data-testid": id,
  };

  let control: React.ReactNode;
  switch (field.type) {
    case "text":
      control = (
        <input
          {...common}
          type="text"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
      break;
    case "number":
      control = (
        <input
          {...common}
          type="number"
          inputMode="decimal"
          step="any"
          value={value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      );
      break;
    case "date":
      control = (
        <input
          {...common}
          type="date"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
      break;
    case "checkbox":
      control = (
        <input
          {...common}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
      break;
    case "single_select":
      control = (
        <select
          {...common}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">Not set</option>
          {field.options?.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case "multi_select": {
      const selected = Array.isArray(value) ? value : [];
      control = (
        <div {...common} role="group" aria-labelledby={`${id}-label`} className="option-set">
          {field.options?.map((o) => {
            const on = selected.includes(o.id);
            return (
              <label
                key={o.id}
                className={`option-toggle${on ? " is-on" : ""}`}
                style={{ "--chip": o.color ?? "#8a9690" } as React.CSSProperties}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => {
                    const next = on ? selected.filter((x) => x !== o.id) : [...selected, o.id];
                    onChange(next.length ? next : null);
                  }}
                />
                {o.label}
              </label>
            );
          })}
        </div>
      );
      break;
    }
  }

  return (
    <div className={`field${field.type === "checkbox" ? " field-inline" : ""}`}>
      <label
        htmlFor={field.type === "multi_select" ? undefined : id}
        id={`${id}-label`}
        className="field-label"
      >
        {field.name}
        {field.required ? <span className="required"> required</span> : null}
      </label>
      {control}
      {error ? (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
