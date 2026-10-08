import assert from "node:assert/strict";
import test from "node:test";
import { suggestedOrder } from "../src/ordering.js";

test("suggested order preserves tied priorities and unmatched child order", () => {
  const worktree = { repoKey: "app", repoRoot: "/app", checkoutPath: "/app", isLinked: true };
  const workspaces = [
    { workspaceId: "root", label: "app", worktree: { ...worktree, isLinked: false } },
    { workspaceId: "feat-a", label: "feat: a", worktree },
    { workspaceId: "notes", label: "notes", worktree },
    { workspaceId: "fix", label: "fix: a", worktree },
    { workspaceId: "feat-b", label: "FEAT: b", worktree },
    { workspaceId: "misc", label: "misc", worktree },
    { workspaceId: "other", label: "other" },
  ];
  assert.deepEqual(
    suggestedOrder(workspaces, ["fix", "feat"]).map((workspace) => workspace.workspaceId),
    ["root", "fix", "feat-a", "feat-b", "notes", "misc", "other"],
  );
});

test("suggested order preserves roots and sorts children by configured priority", () => {
  const workspaces = [
    { workspaceId: "hq", label: "HQ" },
    {
      workspaceId: "root",
      label: "app",
      worktree: { repoKey: "app", repoRoot: "/app", checkoutPath: "/app", isLinked: false },
    },
    {
      workspaceId: "feat",
      label: "FEAT: A",
      worktree: { repoKey: "app", repoRoot: "/app", checkoutPath: "/a", isLinked: true },
    },
    {
      workspaceId: "fix",
      label: "fix: B",
      worktree: { repoKey: "app", repoRoot: "/app", checkoutPath: "/b", isLinked: true },
    },
    { workspaceId: "other", label: "notes" },
  ];
  assert.deepEqual(
    suggestedOrder(workspaces, ["fix", "feat"]).map((item) => item.workspaceId),
    ["hq", "root", "fix", "feat", "other"],
  );
});
