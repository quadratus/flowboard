import { generateKeyBetween } from "fractional-indexing";
import { invalid } from "./errors.ts";

export type Sibling = { id: string; position: string };
export type Anchor = { afterId?: string; beforeId?: string };

/**
 * Fractional key for one item placed among `siblings` (sorted by position, without the item).
 * afterId wins when both anchors exist. No anchor = append at the end.
 * `paths` names the anchor fields in a 400, for routes that call them something else.
 */
export function placeAmong(
  siblings: Sibling[],
  { afterId, beforeId }: Anchor,
  paths = ["afterId", "beforeId"],
): string {
  const anchorId = afterId ?? beforeId;
  if (!anchorId) return generateKeyBetween(siblings.at(-1)?.position ?? null, null);

  const i = siblings.findIndex((s) => s.id === anchorId);
  if (i === -1) {
    throw invalid([
      { path: afterId ? paths[0] : paths[1], issue: "is not a sibling at the target location" },
    ]);
  }
  const anchor = siblings[i].position;
  // Statuses on different levels can share a position, and generateKeyBetween needs a < b.
  // So use the nearest neighbour with a different position.
  if (afterId) {
    const next = siblings.slice(i + 1).find((s) => s.position > anchor);
    return generateKeyBetween(anchor, next?.position ?? null);
  }
  const prev = siblings.slice(0, i).findLast((s) => s.position < anchor);
  return generateKeyBetween(prev?.position ?? null, anchor);
}
