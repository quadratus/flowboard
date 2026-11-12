import { useState } from "react";
import { api } from "../../api/client.ts";
import { useConfigMutation, useFields } from "../../api/queries.ts";
import type { Container, Field, FieldOption, FieldType } from "../../api/types.ts";
import { ownerLabel } from "../../lib/tree.ts";
import { ConfigError } from "./StatusEditor.tsx";

const TYPE_LABEL: Record<FieldType, string> = {
  text: "Text",
  number: "Number",
  single_select: "Single select",
  multi_select: "Multi select",
  date: "Date",
  checkbox: "Checkbox",
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "f_$1")
    .slice(0, 40);

/**
 * Fields that lists at or below this level show. Inherited fields are read-only here:
 * field keys must be unique on a path, so a level cannot override a field from above.
 */
export function FieldEditor({
  containerId,
  tree,
  isWorkspace,
}: {
  containerId: string;
  tree: Container[];
  isWorkspace: boolean;
}) {
  const fields = useFields(containerId);
  const [adding, setAdding] = useState(false);
  const mutate = useConfigMutation((fn: () => Promise<unknown>) => fn());
  const run = (fn: () => Promise<unknown>, after?: () => void) =>
    mutate.mutate(fn, { onSuccess: after });

  return (
    <section className="panel" aria-labelledby="fields-heading" data-testid="field-editor">
      <h2 id="fields-heading" className="panel-title">
        Custom fields
      </h2>
      <p className="panel-hint">Tasks in every list at or below this level get these fields.</p>

      <ol className="config-rows">
        {fields.data?.length === 0 ? <li className="config-row is-muted">No fields yet.</li> : null}
        {fields.data?.map((f) => (
          <FieldRow
            key={f.id}
            field={f}
            source={f.inherited ? ownerLabel(tree, f.ownerId, containerId) : "added here"}
            onToggleRequired={() =>
              run(() => api("PATCH", `/fields/${f.id}`, { required: !f.required }))
            }
            onArchive={() => run(() => api("DELETE", `/fields/${f.id}`))}
          />
        ))}
      </ol>

      {isWorkspace ? (
        <p className="panel-hint">
          Fields start at the space level. Choose a space, folder or list above.
        </p>
      ) : adding ? (
        <NewField
          onCancel={() => setAdding(false)}
          onSubmit={(body) =>
            run(
              () => api("POST", `/containers/${containerId}/fields`, body),
              () => setAdding(false),
            )
          }
        />
      ) : (
        <button type="button" className="ghost-button" onClick={() => setAdding(true)}>
          Add a field
        </button>
      )}

      {mutate.error ? <ConfigError error={mutate.error} /> : null}
    </section>
  );
}

function FieldRow({
  field,
  source,
  onToggleRequired,
  onArchive,
}: {
  field: Field;
  source: string;
  onToggleRequired: () => void;
  onArchive: () => void;
}) {
  return (
    <li className="config-row">
      <span className="config-name">{field.name}</span>
      <span className="config-meta">
        {TYPE_LABEL[field.type]}
        {field.options ? `, ${field.options.length} options` : ""}
        {field.required ? ", required" : ""}
      </span>
      <span className={`config-source source-${field.inherited ? "inherited" : "added"}`}>
        {source}
      </span>
      {field.inherited ? null : (
        <span className="config-actions">
          <button type="button" className="link-button" onClick={onToggleRequired}>
            {field.required ? "Make optional" : "Make required"}
          </button>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              if (
                window.confirm(
                  `Remove "${field.name}"? Tasks keep their values, and an admin can restore the field.`,
                )
              )
                onArchive();
            }}
          >
            Remove
          </button>
        </span>
      )}
    </li>
  );
}

function NewField({
  onSubmit,
  onCancel,
}: {
  onSubmit: (body: object) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState("");
  const isSelect = type === "single_select" || type === "multi_select";
  const parsed: FieldOption[] = options
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label) => ({ id: slug(label), label }));

  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          key: slug(name),
          name,
          type,
          required,
          ...(isSelect ? { options: parsed } : {}),
        });
      }}
    >
      <label className="field">
        <span className="field-label">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          required
          autoFocus
        />
      </label>
      <label className="field">
        <span className="field-label">Type</span>
        <select value={type} onChange={(e) => setType(e.target.value as FieldType)}>
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      {isSelect ? (
        <label className="field field-wide">
          <span className="field-label">Options, separated by commas</span>
          <input
            value={options}
            onChange={(e) => setOptions(e.target.value)}
            placeholder="Small, Medium, Large"
          />
        </label>
      ) : null}
      <label className="field field-inline">
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
        <span className="field-label">Required</span>
      </label>
      <div className="row-actions">
        <button
          type="submit"
          className="primary-button"
          disabled={!slug(name) || (isSelect && parsed.length === 0)}
        >
          Add field
        </button>
        <button type="button" className="ghost-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
