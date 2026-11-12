import { Navigate } from "react-router";
import { useTree } from "../api/queries.ts";
import { buildTree, type TreeNode } from "../lib/tree.ts";

/** Opens the first list the user can see. An empty tree gets a direction, not a blank page. */
export function Home() {
  const tree = useTree();
  if (tree.isPending) return null;
  const first = firstList(buildTree(tree.data ?? []));
  if (first) return <Navigate to={`/lists/${first.id}`} replace />;
  return (
    <div className="empty-page">
      <h1>No lists to show</h1>
      <p>Ask an admin to give you access to a space, folder or list.</p>
    </div>
  );
}

/** The first list in sidebar order (depth first), so home opens the list at the top of the tree. */
function firstList(nodes: TreeNode[]): TreeNode | undefined {
  for (const n of nodes) {
    if (n.type === "list") return n;
    const found = firstList(n.children);
    if (found) return found;
  }
  return undefined;
}
