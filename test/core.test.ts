import assert from "node:assert/strict";
import test from "node:test";
import {
  moveFocused,
  prefixRank,
  reorderWorkspace,
  sortAll,
  sortPlan,
  workspaceDepth,
} from "../src/core.js";
import type { Workspace, WorkspaceClient } from "../src/types.js";

class FakeClient implements WorkspaceClient {
  readonly calls: Array<Readonly<{ method: string; params: Readonly<Record<string, unknown>> }>> =
    [];

  constructor(private readonly values: readonly Workspace[]) {}

  async workspaces(): Promise<readonly Workspace[]> {
    return this.values;
  }

  async request(
    method: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    this.calls.push({ method, params });
    return {};
  }
}

const workspaces = [
  { workspaceId: "a", label: "A" },
  { workspaceId: "b", label: "B" },
  { workspaceId: "c", label: "C" },
] as const;

test("move up uses the previous insert index", async () => {
  const client = new FakeClient(workspaces);
  assert.equal(await moveFocused(client, "b", -1), true);
  assert.deepEqual(client.calls, [
    {
      method: "workspace.move",
      params: { workspace_id: "b", insert_index: 0 },
    },
  ]);
});

test("move down inserts after the next workspace", async () => {
  const client = new FakeClient(workspaces);
  assert.equal(await moveFocused(client, "b", 1), true);
  assert.deepEqual(client.calls, [
    {
      method: "workspace.move",
      params: { workspace_id: "b", insert_index: 3 },
    },
  ]);
});

test("moving past a boundary is a no-op", async () => {
  const client = new FakeClient(workspaces);
  assert.equal(await moveFocused(client, "a", -1), false);
  assert.deepEqual(client.calls, []);
});

test("draft reorder moves a workspace without calling Herdr", () => {
  assert.deepEqual(reorderWorkspace(workspaces, "b", -1), [
    { workspaceId: "b", label: "B" },
    { workspaceId: "a", label: "A" },
    { workspaceId: "c", label: "C" },
  ]);
  assert.equal(reorderWorkspace(workspaces, "a", -1), workspaces);
});

test("moving a repository root moves its linked worktree children as a block", () => {
  const tree = [
    { workspaceId: "hq", label: "HQ" },
    {
      workspaceId: "root",
      label: "app",
      worktree: { repoKey: "app", repoRoot: "/app", checkoutPath: "/app", isLinked: false },
    },
    {
      workspaceId: "child-a",
      label: "FEAT: A",
      worktree: { repoKey: "app", repoRoot: "/app", checkoutPath: "/a", isLinked: true },
    },
    {
      workspaceId: "child-b",
      label: "CHORE: B",
      worktree: { repoKey: "app", repoRoot: "/app", checkoutPath: "/b", isLinked: true },
    },
    { workspaceId: "other", label: "Other" },
  ] as const;
  assert.deepEqual(
    reorderWorkspace(tree, "root", 1).map((item) => item.workspaceId),
    ["hq", "other", "root", "child-a", "child-b"],
  );
  assert.equal(workspaceDepth(tree, 2), 1);
});

test("moving a linked worktree keeps it inside its repository tree", () => {
  const tree = [
    {
      workspaceId: "root",
      label: "app",
      worktree: { repoKey: "app", repoRoot: "/app", checkoutPath: "/app", isLinked: false },
    },
    {
      workspaceId: "a",
      label: "A",
      worktree: { repoKey: "app", repoRoot: "/app", checkoutPath: "/a", isLinked: true },
    },
    {
      workspaceId: "b",
      label: "B",
      worktree: { repoKey: "app", repoRoot: "/app", checkoutPath: "/b", isLinked: true },
    },
    { workspaceId: "other", label: "Other" },
  ] as const;
  assert.deepEqual(
    reorderWorkspace(tree, "a", 1).map((item) => item.workspaceId),
    ["root", "b", "a", "other"],
  );
  assert.equal(reorderWorkspace(tree, "a", -1), tree);
});

test("prefix matching is case-insensitive and requires a boundary", () => {
  assert.equal(prefixRank(" feat: one", ["FEAT", "CHORE"]), 0);
  assert.equal(prefixRank("CHORE", ["FEAT", "CHORE"]), 1);
  assert.equal(prefixRank("FEATURE: no", ["FEAT", "CHORE"]), undefined);
});

test("sort plan groups recognized workspaces stably", () => {
  assert.deepEqual(
    sortPlan(
      [
        { workspaceId: "hq", label: "HQ" },
        { workspaceId: "c1", label: "CHORE: first" },
        { workspaceId: "f1", label: "FEAT: first" },
        { workspaceId: "f2", label: "FEAT: second" },
        { workspaceId: "x1", label: "notes" },
        { workspaceId: "e1", label: "EXPERIMENT: one" },
      ],
      ["FEAT", "CHORE", "EXPERIMENT"],
    ),
    {
      workspace_ids: ["f1", "f2", "c1", "e1"],
      before_workspace_id: "x1",
    },
  );
});

test("sort plan returns undefined when already sorted", () => {
  assert.equal(
    sortPlan(
      [
        { workspaceId: "hq", label: "HQ" },
        { workspaceId: "f1", label: "FEAT: one" },
        { workspaceId: "c1", label: "CHORE: one" },
        { workspaceId: "e1", label: "EXPERIMENT: one" },
      ],
      ["FEAT", "CHORE", "EXPERIMENT"],
    ),
    undefined,
  );
});

test("sort plan appends reordered matches when there is no trailing workspace", () => {
  assert.deepEqual(
    sortPlan(
      [
        { workspaceId: "hq", label: "HQ" },
        { workspaceId: "chore", label: "chore: maintenance" },
        { workspaceId: "feat", label: "feat: search" },
      ],
      ["feat", "chore"],
    ),
    { workspace_ids: ["feat", "chore"], before_workspace_id: null },
  );
});

test("sortAll uses the flat plan when there is no worktree metadata", async () => {
  const client = new FakeClient([
    { workspaceId: "hq", label: "HQ" },
    { workspaceId: "chore", label: "chore: maintenance" },
    { workspaceId: "notes", label: "notes" },
    { workspaceId: "feat", label: "feat: search" },
  ]);
  assert.equal(await sortAll(client, ["feat", "chore"]), true);
  assert.deepEqual(client.calls, [
    {
      method: "workspace.move_block",
      params: { workspace_ids: ["feat", "chore"], before_workspace_id: "notes" },
    },
  ]);
});

test("sortAll sends the full tree order and skips an unchanged tree", async () => {
  const tree = [
    { workspaceId: "hq", label: "HQ" },
    {
      workspaceId: "root",
      label: "app",
      worktree: { repoKey: "app", repoRoot: "/app", checkoutPath: "/app", isLinked: false },
    },
    {
      workspaceId: "feat",
      label: "feat: search",
      worktree: { repoKey: "app", repoRoot: "/app", checkoutPath: "/feat", isLinked: true },
    },
    {
      workspaceId: "fix",
      label: "fix: search",
      worktree: { repoKey: "app", repoRoot: "/app", checkoutPath: "/fix", isLinked: true },
    },
    { workspaceId: "notes", label: "notes" },
  ];
  const client = new FakeClient(tree);
  assert.equal(await sortAll(client, ["fix", "feat"]), true);
  assert.deepEqual(client.calls, [
    {
      method: "workspace.move_block",
      params: {
        workspace_ids: ["hq", "root", "fix", "feat", "notes"],
        before_workspace_id: null,
      },
    },
  ]);
  const unchanged = new FakeClient(tree);
  assert.equal(await sortAll(unchanged, ["feat", "fix"]), false);
  assert.deepEqual(unchanged.calls, []);
});

test("sort plan compacts an untagged workspace out of the group", () => {
  assert.deepEqual(
    sortPlan(
      [
        { workspaceId: "hq", label: "HQ" },
        { workspaceId: "f1", label: "FEAT: one" },
        { workspaceId: "notes", label: "notes" },
        { workspaceId: "c1", label: "CHORE: one" },
      ],
      ["FEAT", "CHORE", "EXPERIMENT"],
    ),
    {
      workspace_ids: ["f1", "c1"],
      before_workspace_id: "notes",
    },
  );
});
