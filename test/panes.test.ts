import assert from "node:assert/strict";
import test from "node:test";
import { HerdrError } from "../src/client.js";
import {
  joinPaneRows,
  largestPane,
  loadPaneTab,
  moveSelectedPanes,
  paneStatusLine,
  readPaneSource,
  splitDirection,
  type PaneMoveRequest,
  type PaneRow,
} from "../src/panes.js";
import type { WorkspaceClient } from "../src/types.js";
import { isRecord } from "../src/utils.js";

type Call = Readonly<{ method: string; params: Readonly<Record<string, unknown>> }>;

class FakeClient implements WorkspaceClient {
  readonly calls: Call[] = [];

  constructor(
    private readonly respond: (
      method: string,
      params: Readonly<Record<string, unknown>>,
    ) => Record<string, unknown>,
  ) {}

  async workspaces() {
    return [];
  }

  async request(method: string, params: Readonly<Record<string, unknown>>) {
    this.calls.push({ method, params });
    return this.respond(method, params);
  }
}

function rect(x: number, y: number, width: number, height: number) {
  return { x, y, width, height };
}

function row(
  paneId: string,
  y: number,
  patch: Partial<Omit<PaneRow, "paneId" | "rect">> & { rect?: PaneRow["rect"] } = {},
): PaneRow {
  return {
    paneId,
    label: patch.label ?? paneId,
    agent: patch.agent ?? "",
    status: patch.status ?? "",
    rect: patch.rect ?? rect(0, y, 40, 20),
  };
}

function layout(
  panes: readonly { pane_id: string; rect: ReturnType<typeof rect> }[],
  zoomed = false,
) {
  return {
    type: "pane_layout",
    layout: {
      workspace_id: "w1",
      tab_id: "w1:t1",
      zoomed,
      focused_pane_id: panes[0]?.pane_id ?? "w1:p1",
      panes,
    },
  };
}

function moveResult(input: {
  changed?: boolean;
  paneId: string;
  previousPaneId?: string;
  createdTabId?: string;
  reason?: string;
  closedTabId?: string;
  closedWorkspaceId?: string;
  layoutPanes?: readonly { pane_id: string; rect: ReturnType<typeof rect> }[];
  tabId?: string;
}) {
  return {
    type: "pane_move",
    move_result: {
      changed: input.changed ?? true,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      ...(input.previousPaneId === undefined ? {} : { previous_pane_id: input.previousPaneId }),
      pane: { pane_id: input.paneId },
      ...(input.createdTabId === undefined ? {} : { created_tab: { tab_id: input.createdTabId } }),
      ...(input.closedTabId === undefined ? {} : { closed_tab_id: input.closedTabId }),
      ...(input.closedWorkspaceId === undefined
        ? {}
        : { closed_workspace_id: input.closedWorkspaceId }),
      ...(input.layoutPanes === undefined
        ? {}
        : {
            target_layout: {
              workspace_id: "w2",
              tab_id: input.tabId ?? input.createdTabId ?? "w1:t2",
              zoomed: false,
              panes: input.layoutPanes,
            },
          }),
    },
  };
}

function request(patch: Partial<PaneMoveRequest> = {}): PaneMoveRequest {
  return {
    panes: [row("p1", 0), row("p2", 10)],
    stayIds: new Set(),
    destination: "tab",
    topicName: "logs",
    sourceTabId: "w1:t1",
    sourceWorkspaceId: "w1",
    layoutPaneId: "p1",
    ...patch,
  };
}

const methods = (client: FakeClient): string[] => client.calls.map((call) => call.method);

test("panes are joined in reading order with label, agent, and status", () => {
  const rows = joinPaneRows(
    {
      workspaceId: "w1",
      tabId: "w1:t1",
      zoomed: false,
      panes: [
        { paneId: "right", rect: rect(40, 0, 20, 10) },
        { paneId: "lower", rect: rect(0, 12, 20, 10) },
        { paneId: "left", rect: rect(0, 0, 20, 10) },
      ],
    },
    [
      { paneId: "right", label: "shell", agent: "", status: "idle" },
      { paneId: "left", label: "editor", agent: "claude", status: "working" },
    ],
  );
  assert.deepEqual(
    rows.map((pane) => [pane.paneId, pane.label, pane.agent, pane.status]),
    [
      ["left", "editor", "claude", "working"],
      ["right", "shell", "", "idle"],
      ["lower", "lower", "", ""],
    ],
  );
});

test("the source tab comes from HERDR_TAB_ID and the context pane, not HERDR_PANE_ID", () => {
  assert.deepEqual(
    readPaneSource({
      HERDR_TAB_ID: "w1:t9",
      HERDR_WORKSPACE_ID: "w1",
      HERDR_PANE_ID: "w1:p-live",
      HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({
        tab_id: "w1:t1",
        workspace_id: "w9",
        focused_pane_id: "w1:p3",
      }),
    }),
    { tabId: "w1:t9", workspaceId: "w1", paneId: "w1:p3" },
  );
});

test("loading uses the context pane, then pane.list, for the tab that was current", async () => {
  const client = new FakeClient((method) => {
    if (method === "pane.layout") {
      return layout([
        { pane_id: "w1:p2", rect: rect(0, 8, 10, 10) },
        { pane_id: "w1:p1", rect: rect(0, 0, 10, 8) },
      ]);
    }
    if (method === "pane.list") {
      return {
        type: "pane_list",
        panes: [
          {
            pane_id: "w1:p1",
            tab_id: "w1:t1",
            label: "editor",
            agent: "claude",
            agent_status: "working",
          },
          { pane_id: "w1:p2", tab_id: "w1:t1", label: "shell", agent_status: "idle" },
          { pane_id: "w1:p9", tab_id: "w1:t2", label: "other" },
        ],
      };
    }
    if (method === "tab.list") {
      return { type: "tab_list", tabs: [{ tab_id: "w1:t1" }, { tab_id: "w1:t2" }] };
    }
    throw new Error(`unexpected ${method}`);
  });
  const snapshot = await loadPaneTab(client, {
    HERDR_TAB_ID: "w1:t1",
    HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ focused_pane_id: "w1:p1", workspace_id: "w1" }),
    HERDR_PANE_ID: "ignored",
  });
  assert.equal(snapshot.loadError, undefined);
  assert.deepEqual(
    snapshot.panes.map((pane) => pane.paneId),
    ["w1:p1", "w1:p2"],
  );
  assert.equal(snapshot.panes[0]?.agent, "claude");
  assert.equal(snapshot.panes[0]?.status, "working");
  assert.equal(snapshot.tabCount, 2);
  assert.equal(snapshot.layoutPaneId, "w1:p1");
  assert.deepEqual(
    client.calls.map((call) => call.method),
    ["pane.layout", "pane.list", "tab.list"],
  );
  assert.deepEqual(client.calls[0]?.params, { pane_id: "w1:p1" });
});

test("the status line names an empty source before Enter", () => {
  const panes = [row("p1", 0, { agent: "claude", status: "working" })];
  assert.equal(
    paneStatusLine({
      panes,
      stayIds: new Set(),
      destination: "tab",
      topicName: "logs",
      tabCount: 2,
    }),
    '1 pane will move to a new Herdr tab "logs". This Herdr tab will close. The workspace stays. An in-flight agent.wait ends with agent_not_running and is not restarted.',
  );
  assert.equal(
    paneStatusLine({
      panes,
      stayIds: new Set(),
      destination: "workspace",
      topicName: "logs",
      tabCount: 2,
    }),
    '1 pane will move to a new workspace "logs". This Herdr tab will close. The workspace stays. An in-flight agent.wait ends with agent_not_running and is not restarted.',
  );
  assert.equal(
    paneStatusLine({
      panes,
      stayIds: new Set(),
      destination: "workspace",
      topicName: "logs",
      tabCount: 1,
    }),
    '1 pane will move to a new workspace "logs". This workspace will close. An in-flight agent.wait ends with agent_not_running and is not restarted.',
  );
  assert.equal(
    paneStatusLine({
      panes: [row("p1", 0), row("p2", 1)],
      stayIds: new Set(["p2"]),
      destination: "tab",
      topicName: "",
      tabCount: 1,
    }),
    "1 pane will move to a new Herdr tab. 1 pane stays here. Type a topic name.",
  );
});

test("the largest pane splits down when it is at least as tall as it is wide", () => {
  assert.equal(splitDirection(rect(0, 0, 10, 10)), "down");
  assert.equal(splitDirection(rect(0, 0, 10, 30)), "down");
  assert.equal(splitDirection(rect(0, 0, 30, 10)), "right");
  const largest = largestPane([
    { paneId: "small", rect: rect(0, 0, 10, 10) },
    { paneId: "wide", rect: rect(10, 0, 40, 20) },
    { paneId: "tie-lower", rect: rect(0, 20, 20, 20) },
    { paneId: "tie-upper", rect: rect(0, 0, 20, 20) },
  ]);
  assert.equal(largest?.paneId, "wide");
});

test("Enter moves unmarked panes in reading order and does not apply a workspace move", async () => {
  const moves = [
    moveResult({
      paneId: "w2:p1",
      previousPaneId: "p2",
      createdTabId: "w1:t2",
      layoutPanes: [{ pane_id: "p2", rect: rect(0, 0, 20, 40) }],
    }),
    moveResult({
      paneId: "w2:p2",
      previousPaneId: "p1",
      tabId: "w1:t2",
      layoutPanes: [
        { pane_id: "w2:p1", rect: rect(0, 0, 20, 20) },
        { pane_id: "p1", rect: rect(0, 20, 20, 20) },
      ],
    }),
  ];
  let moveIndex = 0;
  const client = new FakeClient((method) => {
    if (method === "pane.layout") {
      return layout([
        { pane_id: "p1", rect: rect(0, 10, 10, 10) },
        { pane_id: "p2", rect: rect(0, 0, 10, 10) },
        { pane_id: "stay", rect: rect(10, 0, 10, 10) },
      ]);
    }
    if (method === "pane.move") {
      const next = moves[moveIndex];
      moveIndex += 1;
      if (next === undefined) {
        throw new Error("unexpected extra pane.move");
      }
      return next;
    }
    if (method === "tab.focus") {
      return { type: "tab_info", tab: { tab_id: "w1:t2" } };
    }
    throw new Error(`unexpected ${method}`);
  });
  const outcome = await moveSelectedPanes(
    client,
    request({
      panes: [row("p1", 10), row("stay", 0, { rect: rect(10, 0, 10, 10) }), row("p2", 0)],
      stayIds: new Set(["stay"]),
      topicName: "Feat: Search",
    }),
  );
  assert.equal(outcome.close, true);
  assert.deepEqual(methods(client), ["pane.layout", "pane.move", "pane.move", "tab.focus"]);
  assert.deepEqual(client.calls[1]?.params, {
    pane_id: "p2",
    destination: { type: "new_tab", label: "Feat: Search", workspace_id: "w1" },
    focus: false,
  });
  assert.deepEqual(client.calls[2]?.params, {
    pane_id: "p1",
    destination: {
      type: "tab",
      tab_id: "w1:t2",
      target_pane_id: "w2:p1",
      split: "down",
      ratio: 0.5,
    },
    focus: false,
  });
  assert.deepEqual(client.calls[3]?.params, { tab_id: "w1:t2" });
  assert.equal(methods(client).includes("workspace.move_block"), false);
  assert.equal(methods(client).includes("pane.zoom"), false);
});

test("a new workspace chains the public pane id from the move result", async () => {
  const client = new FakeClient((method) => {
    if (method === "pane.layout") {
      return layout([
        { pane_id: "p1", rect: rect(0, 0, 80, 20) },
        { pane_id: "p2", rect: rect(0, 20, 80, 20) },
      ]);
    }
    if (
      method === "pane.move" &&
      client.calls.filter((call) => call.method === "pane.move").length === 1
    ) {
      return moveResult({
        paneId: "w9:p1",
        previousPaneId: "p1",
        createdTabId: "w9:t1",
        layoutPanes: [{ pane_id: "p1", rect: rect(0, 0, 80, 20) }],
      });
    }
    if (method === "pane.move") {
      return moveResult({
        paneId: "w9:p2",
        previousPaneId: "p2",
        tabId: "w9:t1",
        layoutPanes: [
          { pane_id: "w9:p1", rect: rect(0, 0, 80, 10) },
          { pane_id: "w9:p2", rect: rect(0, 10, 80, 10) },
        ],
      });
    }
    if (method === "tab.focus") {
      return { type: "tab_info", tab: { tab_id: "w9:t1" } };
    }
    throw new Error(`unexpected ${method}`);
  });
  const outcome = await moveSelectedPanes(client, request({ destination: "workspace" }));
  assert.equal(outcome.close, true);
  assert.deepEqual(client.calls[1]?.params, {
    pane_id: "p1",
    destination: { type: "new_workspace", label: "logs", tab_label: "logs" },
    focus: false,
  });
  const second = client.calls[2]?.params.destination;
  assert.ok(isRecord(second));
  assert.equal(second.target_pane_id, "w9:p1");
  assert.equal(second.split, "right");
});

test("Enter does not move when the name is empty, every row stays, or the layout changed", async () => {
  const client = new FakeClient(() => {
    throw new Error("no request");
  });
  assert.deepEqual(await moveSelectedPanes(client, request({ topicName: "   " })), {
    close: false,
    message: "Type the topic name.",
  });
  assert.deepEqual(await moveSelectedPanes(client, request({ stayIds: new Set(["p1", "p2"]) })), {
    close: false,
    message: "Nothing to move.",
  });
  assert.deepEqual(methods(client), []);

  const zoomed = new FakeClient(() =>
    layout(
      [
        { pane_id: "p1", rect: rect(0, 0, 10, 10) },
        { pane_id: "p2", rect: rect(0, 10, 10, 10) },
      ],
      true,
    ),
  );
  const zoomedOutcome = await moveSelectedPanes(zoomed, request());
  assert.equal(zoomedOutcome.close, false);
  assert.match(zoomedOutcome.message, /prefix\+z/);
  assert.deepEqual(methods(zoomed), ["pane.layout"]);

  const changed = new FakeClient(() =>
    layout([
      { pane_id: "p1", rect: rect(0, 0, 10, 10) },
      { pane_id: "p3", rect: rect(0, 10, 10, 10) },
    ]),
  );
  const changedOutcome = await moveSelectedPanes(changed, request());
  assert.deepEqual(changedOutcome, {
    close: false,
    message: "The layout changed. Nothing was moved.",
  });
  assert.deepEqual(methods(changed), ["pane.layout"]);
});

test("a failed move stops the sequence without retry or a later move", async () => {
  let moves = 0;
  const client = new FakeClient((method) => {
    if (method === "pane.layout") {
      return layout([
        { pane_id: "p1", rect: rect(0, 0, 10, 40) },
        { pane_id: "p2", rect: rect(0, 40, 10, 10) },
        { pane_id: "p3", rect: rect(0, 50, 10, 10) },
      ]);
    }
    if (method === "pane.move") {
      moves += 1;
      if (moves === 1) {
        return moveResult({
          paneId: "p1",
          createdTabId: "w1:t2",
          layoutPanes: [{ pane_id: "p1", rect: rect(0, 0, 10, 40) }],
        });
      }
      return moveResult({
        changed: false,
        paneId: "p2",
        reason: "zoomed_tab",
        closedTabId: "w1:t9",
      });
    }
    throw new Error(`unexpected ${method}`);
  });
  const outcome = await moveSelectedPanes(
    client,
    request({ panes: [row("p1", 0), row("p2", 40), row("p3", 50)] }),
  );
  assert.equal(outcome.close, false);
  assert.equal(
    outcome.message,
    "Moved 1. Unzoom with prefix+z and open the popup again. Closed Herdr tab w1:t9.",
  );
  assert.equal(client.calls.filter((call) => call.method === "pane.move").length, 2);
  assert.equal(methods(client).includes("tab.focus"), false);
  assert.equal(methods(client).includes("pane.zoom"), false);
});

test("a socket drop stops after one request and does not retry", async () => {
  let moves = 0;
  const client = new FakeClient((method) => {
    if (method === "pane.layout") {
      return layout([
        { pane_id: "p1", rect: rect(0, 0, 10, 10) },
        { pane_id: "p2", rect: rect(0, 10, 10, 10) },
      ]);
    }
    if (method === "tab.focus") {
      return { type: "tab_info", tab: { tab_id: "w1:t2" } };
    }
    moves += 1;
    if (moves === 1) {
      return moveResult({
        paneId: "p1",
        createdTabId: "w1:t2",
        closedTabId: "w1:t1",
        layoutPanes: [{ pane_id: "p1", rect: rect(0, 0, 40, 10) }],
      });
    }
    throw new HerdrError("Herdr socket timed out", true);
  });
  const outcome = await moveSelectedPanes(client, request());
  assert.equal(outcome.close, false);
  assert.equal(outcome.message, "Moved 1. The last request may have succeeded.");
  assert.equal(client.calls.filter((call) => call.method === "pane.move").length, 2);
  assert.deepEqual(
    client.calls.filter((call) => call.method === "tab.focus").map((call) => call.params),
    [{ tab_id: "w1:t2" }],
  );
});

test("same_tab reports the reason and does not continue", async () => {
  const client = new FakeClient((method) => {
    if (method === "pane.layout") {
      return layout([{ pane_id: "p1", rect: rect(0, 0, 10, 10) }]);
    }
    return moveResult({ changed: false, paneId: "p1", reason: "same_tab" });
  });
  const outcome = await moveSelectedPanes(client, request({ panes: [row("p1", 0)] }));
  assert.equal(
    outcome.message,
    "Moved 0. same_tab. The first call should have created a different Herdr tab.",
  );
  assert.equal(client.calls.filter((call) => call.method === "pane.move").length, 1);
  assert.equal(outcome.close, false);
});
