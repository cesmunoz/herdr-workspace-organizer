import assert from "node:assert/strict";
import test from "node:test";
import { applyPanelKey, createPanelState, type PanelState } from "../src/panel.js";
import type { PaneRow } from "../src/panes.js";

const panes: readonly PaneRow[] = [
  {
    paneId: "p1",
    label: "editor",
    agent: "claude",
    status: "working",
    rect: { x: 0, y: 0, width: 80, height: 40 },
  },
  {
    paneId: "p2",
    label: "shell",
    agent: "",
    status: "idle",
    rect: { x: 0, y: 40, width: 80, height: 20 },
  },
];

function paneState(): PanelState {
  return createPanelState({
    original: [
      { workspaceId: "a", label: "A" },
      { workspaceId: "b", label: "B" },
    ],
    order: ["fix", "feat"],
    focusedId: "a",
    paneTab: {
      panes,
      sourceTabId: "w1:t1",
      sourceWorkspaceId: "w1",
      layoutPaneId: "p1",
      tabCount: 2,
      focusedPaneId: "p1",
    },
  });
}

function ids(state: PanelState): string[] {
  return state.manualDraft.map((workspace) => workspace.workspaceId);
}

test("tab only cycles and leaves the workspace draft in place", () => {
  let state = paneState();
  state = applyPanelKey(state, "", { name: "j", shift: true }).state;
  const draft = ids(state);
  assert.deepEqual(draft, ["b", "a"]);
  for (const tab of ["suggested", "configure", "panes", "manual"] as const) {
    const next = applyPanelKey(state, "", { name: "tab" });
    assert.equal(next.effect.kind, "none");
    assert.equal(next.state.tab, tab);
    assert.deepEqual(ids(next.state), draft);
    state = next.state;
  }
  assert.equal(applyPanelKey(state, "", { name: "return" }).effect.kind, "apply-workspaces");
});

test("Enter on Manual and Suggested order applies the draft, and Priorities saves", () => {
  const dirty = applyPanelKey(paneState(), "", { name: "j", shift: true }).state;
  assert.equal(applyPanelKey(dirty, "", { name: "return" }).effect.kind, "apply-workspaces");
  const suggested = applyPanelKey(dirty, "", { name: "tab" }).state;
  assert.equal(suggested.tab, "suggested");
  assert.equal(applyPanelKey(suggested, "", { name: "return" }).effect.kind, "apply-workspaces");
  const priorities = applyPanelKey(suggested, "", { name: "tab" }).state;
  assert.equal(priorities.tab, "configure");
  assert.equal(applyPanelKey(priorities, "", { name: "return" }).effect.kind, "save-priorities");
});

test("Move panes keys do not run on the other tabs", () => {
  const state = paneState();
  for (const name of ["s", "n", "x", "space"] as const) {
    const next = applyPanelKey(state, name === "space" ? " " : name, { name });
    assert.equal(next.state.tab, "manual");
    assert.equal(next.state.destination, "tab");
    assert.equal(next.state.stayIds.size, 0);
    assert.equal(next.state.editMode, undefined);
    assert.equal(next.effect.kind, "none");
  }
});

test("workspace keys do not run on Move panes", () => {
  const dirty = applyPanelKey(paneState(), "", { name: "j", shift: true }).state;
  const onPanes = { ...dirty, tab: "panes" as const, message: "" };
  for (const name of ["u", "a", "e", "d"] as const) {
    const next = applyPanelKey(onPanes, "", { name });
    assert.deepEqual(ids(next.state), ids(dirty));
    assert.deepEqual(next.state.order, dirty.order);
    assert.equal(next.state.editMode, undefined);
    assert.equal(next.effect.kind, "none");
  }
  const shifted = applyPanelKey(onPanes, "", { name: "j", shift: true });
  assert.deepEqual(ids(shifted.state), ids(dirty));
  assert.equal(shifted.effect.kind, "none");
});

test("stay marks, destination, and the topic name belong to Move panes", () => {
  let state: PanelState = { ...paneState(), tab: "panes" };
  state = applyPanelKey(state, " ", { name: "space" }).state;
  assert.deepEqual([...state.stayIds], ["p1"]);
  state = applyPanelKey(state, "", { name: "j" }).state;
  state = applyPanelKey(state, "", { name: "space" }).state;
  assert.deepEqual([...state.stayIds], ["p1", "p2"]);
  state = applyPanelKey(state, "", { name: "x" }).state;
  assert.equal(state.stayIds.size, 0);
  assert.equal(state.tab, "panes");
  state = applyPanelKey(state, "", { name: "s" }).state;
  assert.equal(state.destination, "workspace");
  state = applyPanelKey(state, "", { name: "s" }).state;
  assert.equal(state.destination, "tab");
  let editing = applyPanelKey(state, "", { name: "n" });
  assert.equal(editing.effect.kind, "none");
  assert.equal(editing.state.editMode?.kind, "topic");
  for (const input of "Feat: Search") {
    editing = applyPanelKey(editing.state, input, {});
  }
  const committed = applyPanelKey(editing.state, "", { name: "return" });
  assert.equal(committed.effect.kind, "none");
  assert.equal(committed.state.topicName, "Feat: Search");
  assert.equal(committed.state.tab, "panes");
  const cancelled = applyPanelKey(
    { ...committed.state, editMode: { kind: "topic", value: "other" } },
    "",
    { name: "escape" },
  );
  assert.equal(cancelled.effect.kind, "none");
  assert.equal(cancelled.state.tab, "panes");
  assert.equal(cancelled.state.topicName, "Feat: Search");
  assert.equal(cancelled.state.message, "Edit cancelled.");
});

test("Enter on Move panes does not apply the workspace draft", () => {
  const dirty = applyPanelKey(paneState(), "", { name: "j", shift: true }).state;
  const onPanes = { ...dirty, tab: "panes" as const };
  const empty = applyPanelKey(onPanes, "", { name: "return" });
  assert.equal(empty.effect.kind, "none");
  assert.equal(empty.state.editMode?.kind, "topic");
  assert.equal(empty.state.message, "Type the topic name.");
  assert.deepEqual(ids(empty.state), ids(dirty));

  const staying = applyPanelKey(
    { ...onPanes, topicName: "logs", stayIds: new Set(["p1", "p2"]) },
    "",
    { name: "return" },
  );
  assert.equal(staying.effect.kind, "none");
  assert.equal(staying.state.message, "Nothing to move.");
  assert.deepEqual(ids(staying.state), ids(dirty));

  const moving = applyPanelKey({ ...onPanes, topicName: "logs" }, "", { name: "return" });
  assert.equal(moving.effect.kind, "move-panes");
  assert.deepEqual(ids(moving.state), ids(dirty));
  assert.notEqual(moving.effect.kind, "apply-workspaces");
});

test("cancel closes Move panes without an apply, save, or move effect", () => {
  const dirty = applyPanelKey(paneState(), "", { name: "j", shift: true }).state;
  const onPanes = { ...dirty, tab: "panes" as const, topicName: "logs" };
  for (const key of [{ name: "escape" }, { name: "q" }, { name: "c", ctrl: true }] as const) {
    const next = applyPanelKey(onPanes, "", key);
    assert.equal(next.effect.kind, "close");
    assert.deepEqual(ids(next.state), ["b", "a"]);
    assert.equal(next.state.topicName, "logs");
  }
  const editing = applyPanelKey(
    { ...onPanes, editMode: { kind: "topic", value: "half" }, topicName: "" },
    "",
    { name: "c", ctrl: true },
  );
  assert.equal(editing.effect.kind, "close");
  assert.equal(editing.state.topicName, "");
  const renaming = applyPanelKey(
    { ...paneState(), tab: "configure", editMode: { kind: "rename", value: "Feat" } },
    "",
    { name: "c", ctrl: true },
  );
  assert.equal(renaming.effect.kind, "none");
  assert.equal(renaming.state.tab, "configure");
});
