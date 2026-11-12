import { describe, expect, it } from "vite-plus/test";
import {
  mergeValues,
  stripUnknown,
  validateCustomFields,
  type FieldDef,
} from "../src/modules/fields/validate.ts";

const opts = [
  { id: "opt_web", label: "Web" },
  { id: "opt_api", label: "API" },
];
const defs: FieldDef[] = [
  { key: "notes", type: "text", required: false, options: null },
  { key: "estimate", type: "number", required: true, options: null },
  { key: "team", type: "single_select", required: false, options: opts },
  { key: "labels", type: "multi_select", required: false, options: opts },
  { key: "due_review", type: "date", required: false, options: null },
  { key: "urgent", type: "checkbox", required: false, options: null },
];

const issuesFor = (values: Record<string, unknown>) =>
  validateCustomFields(defs, { estimate: 1, ...values });

describe("validateCustomFields", () => {
  it("accepts a valid value of every type", () => {
    expect(
      issuesFor({
        notes: "hi",
        estimate: 2.5,
        team: "opt_web",
        labels: ["opt_web", "opt_api"],
        due_review: "2026-02-28",
        urgent: false,
      }),
    ).toEqual([]);
  });

  it.each([
    ["notes", 5, "expected string, received number"],
    ["notes", "x".repeat(5001), "must be at most 5000 characters"],
    ["estimate", "5", "expected number, received string"],
    ["estimate", Number.NaN, "expected number, received number"],
    ["team", "Web", "option 'Web' does not exist"],
    ["team", ["opt_web"], "expected an option id, received array"],
    ["labels", "opt_web", "expected an array of option ids, received string"],
    ["labels", ["opt_web", "opt_web"], "contains duplicate options"],
    ["labels", ["opt_web", "opt_x"], "option 'opt_x' does not exist"],
    ["due_review", "2026-02-30", "is not a real calendar date"],
    ["due_review", "next week", "expected a date as YYYY-MM-DD"],
    ["urgent", "yes", "expected boolean, received string"],
  ])("rejects %s = %j", (key, value, issue) => {
    expect(issuesFor({ [key]: value })).toEqual([{ path: `customFields.${key}`, issue }]);
  });

  it("rejects a key that the schema does not define", () => {
    expect(issuesFor({ estimat: 3 })).toEqual([
      { path: "customFields.estimat", issue: "unknown field for this list" },
    ]);
  });

  it("requires a required field, and treats null as missing", () => {
    expect(validateCustomFields(defs, {})).toEqual([
      { path: "customFields.estimate", issue: "is required" },
    ]);
    expect(validateCustomFields(defs, { estimate: null })).toEqual([
      { path: "customFields.estimate", issue: "is required" },
    ]);
  });

  it("reports every issue at once", () => {
    expect(
      validateCustomFields(defs, { estimate: "8", labels: "opt_web", colour: "red" }),
    ).toHaveLength(3);
  });
});

describe("mergeValues", () => {
  it("keeps untouched keys, replaces patched keys and clears nulls", () => {
    expect(mergeValues({ a: 1, b: 2, c: 3 }, { b: 20, c: null })).toEqual({ a: 1, b: 20 });
  });
});

describe("stripUnknown", () => {
  it("drops keys that the destination schema does not define", () => {
    expect(stripUnknown(defs, { estimate: 1, gone: true })).toEqual({
      kept: { estimate: 1 },
      stripped: ["gone"],
    });
  });
});
