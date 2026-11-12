import { invalid } from "./errors.ts";

/** Opaque keyset cursor: the sort value and the id of the last row on the page. */
export type Cursor = { v: string | number | null; id: string };

export const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString("base64url");

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
    if (typeof c.id === "string" && ["string", "number"].includes(typeof c.v)) return c;
  } catch {
    // fall through to the 400
  }
  throw invalid([{ path: "query.cursor", issue: "is not a cursor from this API" }]);
}
