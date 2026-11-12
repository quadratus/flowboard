import type { Container } from "../api/types.ts";

export type TreeNode = Container & { children: TreeNode[] };

/** Builds the nesting from the flat /tree response (parents come before children, sorted). */
export function buildTree(flat: Container[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  for (const c of flat) {
    const node: TreeNode = { ...c, children: [] };
    byId.set(c.id, node);
    const parent = c.parentId ? byId.get(c.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Path from the workspace down to `id`, inclusive. Empty when the caller cannot see it. */
export function pathTo(flat: Container[], id: string): Container[] {
  const byId = new Map(flat.map((c) => [c.id, c]));
  const path: Container[] = [];
  for (let c = byId.get(id); c; c = c.parentId ? byId.get(c.parentId) : undefined) path.unshift(c);
  return path;
}

/**
 * Where a status or field comes from, in words a user reads in a column header.
 * The owner may be hidden from a member (for example a private space); then say "inherited".
 */
export function ownerLabel(flat: Container[], ownerId: string, currentId: string): string {
  if (ownerId === currentId) return "this list";
  const owner = flat.find((c) => c.id === ownerId);
  if (!owner) return "inherited";
  return owner.type === "workspace" ? "workspace default" : `from ${owner.name}`;
}
