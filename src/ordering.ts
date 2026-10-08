import { orderBy } from "lodash-es";
import { prefixRank, workspaceDepth } from "./core.js";
import type { Workspace } from "./types.js";

function sortSiblings(
  siblings: readonly Workspace[],
  order: readonly string[],
): readonly Workspace[] {
  const ranked = siblings.map((workspace, index) => ({
    workspace,
    index,
    rank: prefixRank(workspace.label, order),
  }));
  const recognized = orderBy(
    ranked.filter((item) => item.rank !== undefined),
    ["rank", "index"],
  );
  const ungrouped = ranked.filter((item) => item.rank === undefined);
  return [...recognized, ...ungrouped].map((item) => item.workspace);
}

export function suggestedOrder(
  workspaces: readonly Workspace[],
  order: readonly string[],
): readonly Workspace[] {
  const result: Workspace[] = [];
  let index = 0;
  while (index < workspaces.length) {
    const root = workspaces[index];
    if (root === undefined) {
      break;
    }
    result.push(root);
    index += 1;
    const children: Workspace[] = [];
    while (index < workspaces.length && workspaceDepth(workspaces, index) === 1) {
      const child = workspaces[index];
      if (child !== undefined) {
        children.push(child);
      }
      index += 1;
    }
    result.push(...sortSiblings(children, order));
  }
  return result;
}
