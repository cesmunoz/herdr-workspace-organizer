import { orderBy } from "lodash-es";
import type { MoveBlockParams, Workspace, WorkspaceClient } from "./types.js";
import { suggestedOrder } from "./ordering.js";

export const DEFAULT_PREFIXES = [
  "fix",
  "feat",
  "docs",
  "style",
  "refactor",
  "test",
  "build",
  "chore",
  "revert",
  "hotfix",
] as const;

export async function moveFocused(
  client: WorkspaceClient,
  workspaceId: string,
  offset: -1 | 1,
): Promise<boolean> {
  const workspaces = await client.workspaces();
  const currentIndex = workspaces.findIndex((workspace) => workspace.workspaceId === workspaceId);
  if (currentIndex === -1) {
    throw new Error(`focused workspace ${JSON.stringify(workspaceId)} is not in workspace.list`);
  }

  const targetIndex = currentIndex + offset;
  if (targetIndex < 0 || targetIndex >= workspaces.length) {
    return false;
  }

  // Herdr addresses insert_index before removing the moved workspace.
  const insertIndex = offset < 0 ? targetIndex : targetIndex + 1;
  await client.request("workspace.move", {
    workspace_id: workspaceId,
    insert_index: insertIndex,
  });
  return true;
}

function workspaceGroupKey(workspace: Workspace): string {
  return workspace.worktree?.repoKey ?? `workspace:${workspace.workspaceId}`;
}

export function workspaceDepth(workspaces: readonly Workspace[], index: number): 0 | 1 {
  const workspace = workspaces[index];
  if (workspace?.worktree?.isLinked !== true) {
    return 0;
  }
  return workspaces.some(
    (candidate, candidateIndex) =>
      candidateIndex < index &&
      candidate.worktree?.repoKey === workspace.worktree?.repoKey &&
      candidate.worktree?.isLinked === false,
  )
    ? 1
    : 0;
}

function blocks(workspaces: readonly Workspace[]): readonly (readonly Workspace[])[] {
  const result: Workspace[][] = [];
  for (const workspace of workspaces) {
    const previous = result.at(-1);
    const joinsPrevious =
      workspace.worktree?.isLinked === true &&
      previous?.some((item) => workspaceGroupKey(item) === workspaceGroupKey(workspace));
    if (joinsPrevious && previous !== undefined) {
      previous.push(workspace);
    } else {
      result.push([workspace]);
    }
  }
  return result;
}

export function reorderWorkspace(
  workspaces: readonly Workspace[],
  workspaceId: string,
  offset: -1 | 1,
): readonly Workspace[] {
  const currentIndex = workspaces.findIndex((workspace) => workspace.workspaceId === workspaceId);
  if (currentIndex === -1) {
    return workspaces;
  }

  if (workspaceDepth(workspaces, currentIndex) === 1) {
    const selected = workspaces[currentIndex];
    if (selected === undefined) {
      return workspaces;
    }
    const groupKey = workspaceGroupKey(selected);
    const siblingIndexes = workspaces
      .map((workspace, index) => ({ workspace, index }))
      .filter(
        ({ workspace, index }) =>
          workspaceGroupKey(workspace) === groupKey && workspaceDepth(workspaces, index) === 1,
      )
      .map(({ index }) => index);
    const siblingPosition = siblingIndexes.indexOf(currentIndex);
    const targetSiblingIndex = siblingIndexes[siblingPosition + offset];
    if (targetSiblingIndex === undefined) {
      return workspaces;
    }
    const reordered = [...workspaces];
    const [workspace] = reordered.splice(currentIndex, 1);
    if (workspace === undefined) {
      return workspaces;
    }
    reordered.splice(targetSiblingIndex, 0, workspace);
    return reordered;
  }

  const grouped = blocks(workspaces);
  const blockIndex = grouped.findIndex((block) =>
    block.some((workspace) => workspace.workspaceId === workspaceId),
  );
  const targetBlockIndex = blockIndex + offset;
  if (blockIndex === -1 || targetBlockIndex < 0 || targetBlockIndex >= grouped.length) {
    return workspaces;
  }
  const reorderedBlocks = [...grouped];
  const [block] = reorderedBlocks.splice(blockIndex, 1);
  if (block === undefined) {
    return workspaces;
  }
  reorderedBlocks.splice(targetBlockIndex, 0, block);
  return reorderedBlocks.flat();
}

export function prefixRank(label: string, prefixes: readonly string[]): number | undefined {
  const normalized = label.trimStart().toUpperCase();
  for (const [index, prefix] of prefixes.entries()) {
    const normalizedPrefix = prefix.toUpperCase();
    if (normalized === normalizedPrefix || normalized.startsWith(`${normalizedPrefix}:`)) {
      return index;
    }
  }
  return undefined;
}

export function sortPlan(
  workspaces: readonly Workspace[],
  prefixes: readonly string[],
): MoveBlockParams | undefined {
  const ranked = workspaces.map((workspace, index) => ({
    workspace,
    rank: prefixRank(workspace.label, prefixes),
    index,
  }));
  const recognized = ranked.filter(
    (item): item is typeof item & { rank: number } => item.rank !== undefined,
  );
  if (recognized.length < 2) {
    return undefined;
  }

  const firstRecognizedIndex = recognized[0]?.index;
  if (firstRecognizedIndex === undefined) {
    return undefined;
  }

  const sortedIds = orderBy(recognized, ["rank", "index"]).map(
    (item) => item.workspace.workspaceId,
  );
  const leadingIds = workspaces
    .slice(0, firstRecognizedIndex)
    .map((workspace) => workspace.workspaceId);
  const trailingIds = ranked
    .filter((item) => item.index > firstRecognizedIndex && item.rank === undefined)
    .map((item) => item.workspace.workspaceId);
  const desiredOrder = [...leadingIds, ...sortedIds, ...trailingIds];

  if (desiredOrder.every((workspaceId, index) => workspaceId === workspaces[index]?.workspaceId)) {
    return undefined;
  }
  return { workspace_ids: sortedIds, before_workspace_id: trailingIds[0] ?? null };
}

export async function sortAll(
  client: WorkspaceClient,
  prefixes: readonly string[],
): Promise<boolean> {
  const workspaces = await client.workspaces();
  let plan: MoveBlockParams | undefined;
  if (workspaces.some((workspace) => workspace.worktree !== undefined)) {
    const suggestedIds = suggestedOrder(workspaces, prefixes).map(
      (workspace) => workspace.workspaceId,
    );
    const unchanged = suggestedIds.every(
      (workspaceId, index) => workspaceId === workspaces[index]?.workspaceId,
    );
    plan = unchanged ? undefined : { workspace_ids: suggestedIds, before_workspace_id: null };
  } else {
    plan = sortPlan(workspaces, prefixes);
  }
  if (plan === undefined) {
    return false;
  }
  await client.request("workspace.move_block", { ...plan });
  return true;
}
