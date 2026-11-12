import { generateKeyBetween } from "fractional-indexing";
import { invalid } from "./errors.ts";

export type Sibling = { id: string; position: string };
export type Anchor = { afterId?: string; beforeId?: string };

/**
 * Fractional key for one item placed among `siblings` (sorted by position, without the item).
 * afterId wins when both anchors exist. No anchor = append at the end.
 */
export function placeAmong(siblings: Sibling[], { afterId, beforeId }: Anchor): string {
  const anchorId = afterId ?? beforeId;
  if (!anchorId) return generateKeyBetween(siblings.at(-1)?.position ?? null, null);

  const i = siblings.findIndex((s) => s.id === anchorId);
  if (i === -1) {
    throw invalid([
      { path: afterId ? "afterId" : "beforeId", issue: "is not a sibling at the target location" },
    ]);
  }
  return afterId
    ? generateKeyBetween(siblings[i].position, siblings[i + 1]?.position ?? null)
    : generateKeyBetween(siblings[i - 1]?.position ?? null, siblings[i].position);
}
