import type { Issue } from "../../shared/errors.ts";

export type FieldType = "text" | "number" | "single_select" | "multi_select" | "date" | "checkbox";
export type FieldOption = { id: string; label: string; color?: string };
export type FieldDef = {
  key: string;
  type: FieldType;
  required: boolean;
  options: FieldOption[] | null;
};
export type FieldValues = Record<string, unknown>;

const TEXT_MAX = 5000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const describe = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

/** Returns a problem for one non-null value, or null when the value is valid. */
export function checkType(def: FieldDef, value: unknown): string | null {
  switch (def.type) {
    case "text":
      if (typeof value !== "string") return `expected string, received ${describe(value)}`;
      return value.length > TEXT_MAX ? `must be at most ${TEXT_MAX} characters` : null;
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? null
        : `expected number, received ${describe(value)}`;
    case "checkbox":
      return typeof value === "boolean" ? null : `expected boolean, received ${describe(value)}`;
    case "date": {
      if (typeof value !== "string" || !DATE.test(value)) return "expected a date as YYYY-MM-DD";
      // Date.parse accepts 2026-02-30 and rolls it over, so compare the round trip.
      const d = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value)
        ? null
        : "is not a real calendar date";
    }
    case "single_select": {
      if (typeof value !== "string") return `expected an option id, received ${describe(value)}`;
      return def.options!.some((o) => o.id === value) ? null : `option '${value}' does not exist`;
    }
    case "multi_select": {
      if (!Array.isArray(value))
        return `expected an array of option ids, received ${describe(value)}`;
      if (value.some((v) => typeof v !== "string")) return "every item must be an option id string";
      if (new Set(value).size !== value.length) return "contains duplicate options";
      const unknown = value.filter((v) => !def.options!.some((o) => o.id === v));
      return unknown.length ? `option '${unknown.join("', '")}' does not exist` : null;
    }
  }
}

/**
 * Checks the final custom-field map of a task against the resolved schema of its list.
 * Pass the merged map (current values + patch, nulls removed), not the raw request body,
 * so the required check also works on update. Returns every issue, not only the first.
 */
export function validateCustomFields(
  defs: FieldDef[],
  values: FieldValues,
  pathPrefix = "customFields",
): Issue[] {
  const issues: Issue[] = [];
  const byKey = new Map(defs.map((d) => [d.key, d]));

  for (const key of Object.keys(values)) {
    if (!byKey.has(key))
      issues.push({ path: `${pathPrefix}.${key}`, issue: "unknown field for this list" });
  }
  for (const def of defs) {
    const path = `${pathPrefix}.${def.key}`;
    const value = values[def.key];
    if (value === undefined || value === null) {
      if (def.required) issues.push({ path, issue: "is required" });
      continue;
    }
    const problem = checkType(def, value);
    if (problem) issues.push({ path, issue: problem });
  }
  return issues;
}

/** Applies a patch: keys set to null are cleared, other keys are replaced. */
export function mergeValues(current: FieldValues, patch: FieldValues | undefined): FieldValues {
  const merged: FieldValues = { ...current, ...patch };
  for (const [k, v] of Object.entries(merged)) if (v === null) delete merged[k];
  return merged;
}

/** Keeps only the keys that the schema defines. Used when a task moves to another list. */
export function stripUnknown(
  defs: FieldDef[],
  values: FieldValues,
): { kept: FieldValues; stripped: string[] } {
  const keys = new Set(defs.map((d) => d.key));
  const kept: FieldValues = {};
  const stripped: string[] = [];
  for (const [k, v] of Object.entries(values)) {
    if (keys.has(k)) kept[k] = v;
    else stripped.push(k);
  }
  return { kept, stripped };
}
