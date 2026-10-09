import assert from "node:assert/strict";
import test from "node:test";
import { reorderWorkspace, workspaceDepth, workspaceTreeOrder } from "../src/core.js";
import { suggestedOrder } from "../src/ordering.js";
import type { Workspace } from "../src/types.js";

function repository(workspaceId: string, repoKey: string, isLinked: boolean): Workspace {
  return {
    workspaceId,
    label: workspaceId,
    worktree: { repoKey, repoRoot: `/${repoKey}`, checkoutPath: `/${workspaceId}`, isLinked },
  };
}

// Same flat layout returned by workspace.list in the user's test session.
const flat: readonly Workspace[] = [
  { workspaceId: "hq", label: "hq" },
  { workspaceId: "project-1", label: "project 1" },
  repository("project-2", "feed", false),
  repository("project-3", "tero", false),
  repository("project-4", "organizer", false),
  repository("silver-valley", "organizer", true),
  repository("lucky-stone", "organizer", true),
  repository("green-stone", "organizer", true),
  repository("calm-valley", "tero", true),
  repository("calm-river-fd01", "tero", true),
  repository("calm-river-3001", "tero", true),
  repository("silver-cloud", "feed", true),
  repository("calm-stone", "feed", true),
  repository("brave-meadow", "feed", true),
];
const expected = [
  "hq",
  "project-1",
  "project-2",
  "silver-cloud",
  "calm-stone",
  "brave-meadow",
  "project-3",
  "calm-valley",
  "calm-river-fd01",
  "calm-river-3001",
  "project-4",
  "silver-valley",
  "lucky-stone",
  "green-stone",
];
const ids = (workspaces: readonly Workspace[]): readonly string[] =>
  workspaces.map((workspace) => workspace.workspaceId);

test("display order attaches scattered worktrees to their own repository", () => {
  const before = structuredClone(flat);
  const tree = workspaceTreeOrder(flat);
  assert.deepEqual(ids(tree), expected);
  assert.deepEqual(flat, before);
  assert.equal(workspaceTreeOrder(tree), tree);
  assert.deepEqual(
    tree.map((_, index) => workspaceDepth(tree, index)),
    [0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1],
  );
});

test("a child of an earlier but nonadjacent root is not indented under another root", () => {
  assert.equal(workspaceDepth(flat, 5), 1);
  assert.equal(workspaceDepth(flat, 8), 0);
  assert.equal(workspaceDepth(flat, 11), 0);
});

test("suggestions group by repository instead of mixing priorities between trees", () => {
  const values = flat.map((workspace) => ({
    ...workspace,
    label:
      workspace.workspaceId === "calm-stone" || workspace.workspaceId === "lucky-stone"
        ? "fix: urgent"
        : workspace.label,
  }));
  assert.deepEqual(ids(suggestedOrder(values, ["fix"])), [
    "hq",
    "project-1",
    "project-2",
    "calm-stone",
    "silver-cloud",
    "brave-meadow",
    "project-3",
    "calm-valley",
    "calm-river-fd01",
    "calm-river-3001",
    "project-4",
    "lucky-stone",
    "silver-valley",
    "green-stone",
  ]);
});

test("moving a grouped root carries only that repository's children", () => {
  const tree = workspaceTreeOrder(flat);
  assert.deepEqual(ids(reorderWorkspace(tree, "project-3", 1)), [
    "hq",
    "project-1",
    "project-2",
    "silver-cloud",
    "calm-stone",
    "brave-meadow",
    "project-4",
    "silver-valley",
    "lucky-stone",
    "green-stone",
    "project-3",
    "calm-valley",
    "calm-river-fd01",
    "calm-river-3001",
  ]);
  assert.equal(reorderWorkspace(tree, "silver-cloud", -1), tree);
  assert.equal(reorderWorkspace(tree, "brave-meadow", 1), tree);
});

test("children before a visible root are grouped; orphan worktrees remain standalone", () => {
  const orphanA = repository("orphan-a", "missing", true);
  const orphanB = repository("orphan-b", "missing", true);
  const values = [
    orphanA,
    repository("child", "app", true),
    orphanB,
    repository("root", "app", false),
    { workspaceId: "notes", label: "notes" },
  ];
  const tree = workspaceTreeOrder(values);
  assert.deepEqual(ids(tree), ["orphan-a", "orphan-b", "root", "child", "notes"]);
  assert.deepEqual(ids(reorderWorkspace(tree, "orphan-a", 1)), [
    "orphan-b",
    "orphan-a",
    "root",
    "child",
    "notes",
  ]);
});

test("duplicate repository roots do not duplicate or lose children", () => {
  const tree = workspaceTreeOrder([
    repository("root-a", "app", false),
    repository("root-b", "app", false),
    repository("child", "app", true),
  ]);
  assert.deepEqual(ids(tree), ["root-a", "child", "root-b"]);
});
