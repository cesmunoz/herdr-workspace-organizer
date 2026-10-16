import { HerdrError } from "./client.js";
import {
  paneLayoutSchema,
  paneListSchema,
  paneMoveSchema,
  pluginContextSchema,
  tabListSchema,
} from "./schemas.js";
import type { WorkspaceClient } from "./types.js";
import { isRecord } from "./utils.js";

export type PaneRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type PaneRow = Readonly<{
  paneId: string;
  label: string;
  agent: string;
  status: string;
  rect: PaneRect;
}>;

export type PaneDestination = "tab" | "workspace";

export type PaneSource = Readonly<{
  tabId?: string;
  workspaceId?: string;
  paneId?: string;
}>;

export type PaneTabSnapshot = Readonly<{
  panes: readonly PaneRow[];
  sourceTabId?: string;
  sourceWorkspaceId?: string;
  layoutPaneId?: string;
  tabCount: number;
  focusedPaneId?: string;
  loadError?: string;
}>;

export type PaneMoveRequest = Readonly<{
  panes: readonly PaneRow[];
  stayIds: ReadonlySet<string>;
  destination: PaneDestination;
  topicName: string;
  sourceTabId?: string;
  sourceWorkspaceId?: string;
  layoutPaneId?: string;
}>;

export type PaneMoveOutcome = Readonly<{
  close: boolean;
  message: string;
}>;

type LayoutPane = Readonly<{
  paneId: string;
  rect: PaneRect;
}>;

type LayoutSnapshot = Readonly<{
  workspaceId: string;
  tabId: string;
  zoomed: boolean;
  focusedPaneId?: string;
  panes: readonly LayoutPane[];
}>;

type ParsedPaneMove = Readonly<{
  changed: boolean;
  reason?: string;
  previousPaneId?: string;
  paneId: string;
  createdTabId?: string;
  closedTabId?: string;
  closedWorkspaceId?: string;
  layoutPanes?: readonly LayoutPane[];
}>;

function defined(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

function optionalString(value: string | null | undefined): string | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  return value;
}

export function readPaneSource(environment: NodeJS.ProcessEnv): PaneSource {
  let context: PaneSource = {};
  const raw = environment.HERDR_PLUGIN_CONTEXT_JSON;
  if (defined(raw)) {
    try {
      const parsed: unknown = JSON.parse(raw);
      const result = pluginContextSchema.safeParse(parsed);
      if (result.success) {
        context = {
          ...(defined(result.data.tab_id) ? { tabId: result.data.tab_id } : {}),
          ...(defined(result.data.workspace_id) ? { workspaceId: result.data.workspace_id } : {}),
          ...(defined(result.data.focused_pane_id) ? { paneId: result.data.focused_pane_id } : {}),
        };
      }
    } catch {
      context = {};
    }
  }
  const tabId = defined(environment.HERDR_TAB_ID) ? environment.HERDR_TAB_ID : context.tabId;
  const workspaceId = defined(environment.HERDR_WORKSPACE_ID)
    ? environment.HERDR_WORKSPACE_ID
    : context.workspaceId;
  return {
    ...(tabId === undefined ? {} : { tabId }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...(context.paneId === undefined ? {} : { paneId: context.paneId }),
  };
}

function compareReadingOrder(
  left: PaneRect & { paneId: string },
  right: PaneRect & { paneId: string },
): number {
  if (left.y !== right.y) {
    return left.y - right.y;
  }
  if (left.x !== right.x) {
    return left.x - right.x;
  }
  return left.paneId.localeCompare(right.paneId);
}

function mapLayout(value: unknown): LayoutSnapshot | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const candidate = "layout" in value ? value.layout : value;
  const parsed = paneLayoutSchema.safeParse(candidate);
  if (!parsed.success) {
    return undefined;
  }
  const focusedPaneId = optionalString(parsed.data.focused_pane_id);
  return {
    workspaceId: parsed.data.workspace_id,
    tabId: parsed.data.tab_id,
    zoomed: parsed.data.zoomed,
    ...(focusedPaneId === undefined ? {} : { focusedPaneId }),
    panes: parsed.data.panes.map((pane) => ({
      paneId: pane.pane_id,
      rect: pane.rect,
    })),
  };
}

function mapMove(value: unknown): ParsedPaneMove | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const candidate = "move_result" in value ? value.move_result : value;
  const parsed = paneMoveSchema.safeParse(candidate);
  if (!parsed.success) {
    return undefined;
  }
  const reason = optionalString(parsed.data.reason);
  const previousPaneId = optionalString(parsed.data.previous_pane_id);
  const createdTabId = optionalString(parsed.data.created_tab?.tab_id);
  const closedTabId = optionalString(parsed.data.closed_tab_id);
  const closedWorkspaceId = optionalString(parsed.data.closed_workspace_id);
  const layout = parsed.data.target_layout;
  return {
    changed: parsed.data.changed,
    paneId: parsed.data.pane.pane_id,
    ...(reason === undefined ? {} : { reason }),
    ...(previousPaneId === undefined ? {} : { previousPaneId }),
    ...(createdTabId === undefined ? {} : { createdTabId }),
    ...(closedTabId === undefined ? {} : { closedTabId }),
    ...(closedWorkspaceId === undefined ? {} : { closedWorkspaceId }),
    ...(layout === undefined
      ? {}
      : {
          layoutPanes: layout.panes.map((pane) => ({
            paneId: pane.pane_id,
            rect: pane.rect,
          })),
        }),
  };
}

export function joinPaneRows(
  layout: LayoutSnapshot,
  infos: readonly {
    paneId: string;
    label?: string;
    agent?: string;
    status?: string;
  }[],
): readonly PaneRow[] {
  const byId = new Map(infos.map((info) => [info.paneId, info]));
  const rows: PaneRow[] = layout.panes.map((pane) => {
    const info = byId.get(pane.paneId);
    const label = optionalString(info?.label);
    const agent = optionalString(info?.agent);
    const status = optionalString(info?.status);
    return {
      paneId: pane.paneId,
      label: label ?? pane.paneId,
      agent: agent ?? "",
      status: status ?? "",
      rect: pane.rect,
    };
  });
  return rows.sort((left, right) =>
    compareReadingOrder(
      { ...left.rect, paneId: left.paneId },
      { ...right.rect, paneId: right.paneId },
    ),
  );
}

function area(rect: PaneRect): number {
  return rect.width * rect.height;
}

export function splitDirection(rect: PaneRect): "down" | "right" {
  return rect.height >= rect.width ? "down" : "right";
}

export function largestPane<T extends LayoutPane>(panes: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const pane of panes) {
    if (best === undefined || isBetterSplitTarget(pane, best)) {
      best = pane;
    }
  }
  return best;
}

function isBetterSplitTarget(candidate: LayoutPane, current: LayoutPane): boolean {
  const candidateArea = area(candidate.rect);
  const currentArea = area(current.rect);
  if (candidateArea !== currentArea) {
    return candidateArea > currentArea;
  }
  const order = compareReadingOrder(
    { ...candidate.rect, paneId: candidate.paneId },
    { ...current.rect, paneId: current.paneId },
  );
  return order < 0;
}

function chainPaneIds(
  panes: readonly LayoutPane[],
  previousPaneId: string | undefined,
  nextPaneId: string,
): readonly LayoutPane[] {
  if (previousPaneId === undefined || previousPaneId === nextPaneId) {
    return panes;
  }
  return panes.map((pane) =>
    pane.paneId === previousPaneId ? { ...pane, paneId: nextPaneId } : pane,
  );
}

export function paneStatusLine(
  input: Readonly<{
    panes: readonly PaneRow[];
    stayIds: ReadonlySet<string>;
    destination: PaneDestination;
    topicName: string;
    tabCount: number;
    loadError?: string;
  }>,
): string {
  if (input.loadError !== undefined && input.loadError !== "") {
    return input.loadError;
  }
  if (input.panes.length === 0) {
    return "This Herdr tab has no panes.";
  }
  const moving = input.panes.filter((pane) => !input.stayIds.has(pane.paneId));
  const staying = input.panes.length - moving.length;
  if (moving.length === 0) {
    return "Every pane stays.";
  }
  const name = input.topicName.trim();
  const destination = input.destination === "tab" ? "a new Herdr tab" : "a new workspace";
  const named = name === "" ? "" : ` "${name}"`;
  const parts = [
    `${moving.length} ${moving.length === 1 ? "pane" : "panes"} will move to ${destination}${named}.`,
  ];
  if (staying > 0) {
    parts.push(`${staying} ${staying === 1 ? "pane stays" : "panes stay"} here.`);
  } else if (input.destination === "workspace" && input.tabCount <= 1) {
    parts.push("This workspace will close.");
  } else {
    parts.push("This Herdr tab will close. The workspace stays.");
  }
  if (name === "") {
    parts.push("Type a topic name.");
  }
  if (moving.some((pane) => pane.agent !== "")) {
    parts.push("An in-flight agent.wait ends with agent_not_running and is not restarted.");
  }
  return parts.join(" ");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function samePaneIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const seen = new Set(right);
  return left.every((id) => seen.has(id));
}

async function fetchLayout(client: WorkspaceClient, paneId: string): Promise<LayoutSnapshot> {
  const result = await client.request("pane.layout", { pane_id: paneId });
  const layout = mapLayout(result);
  if (layout === undefined) {
    throw new Error("Herdr returned an unexpected pane.layout result");
  }
  return layout;
}

async function resolveLayout(
  client: WorkspaceClient,
  source: PaneSource,
): Promise<LayoutSnapshot | undefined> {
  if (source.paneId !== undefined) {
    const layout = await fetchLayout(client, source.paneId);
    if (source.tabId === undefined || layout.tabId === source.tabId) {
      return layout;
    }
  }
  if (source.tabId === undefined) {
    return undefined;
  }
  const listed = paneListSchema.parse(
    await client.request(
      "pane.list",
      source.workspaceId === undefined ? {} : { workspace_id: source.workspaceId },
    ),
  );
  const match = listed.panes.find((pane) => pane.tab_id === source.tabId);
  if (match === undefined) {
    return undefined;
  }
  const layout = await fetchLayout(client, match.pane_id);
  if (layout.tabId !== source.tabId) {
    throw new Error("The layout changed. Open the popup again.");
  }
  return layout;
}

export async function loadPaneTab(
  client: WorkspaceClient,
  environment: NodeJS.ProcessEnv,
): Promise<PaneTabSnapshot> {
  try {
    const source = readPaneSource(environment);
    const layout = await resolveLayout(client, source);
    if (layout === undefined) {
      return { panes: [], tabCount: 0, loadError: "No Herdr tab is available." };
    }
    const listed = paneListSchema.parse(
      await client.request("pane.list", { workspace_id: layout.workspaceId }),
    );
    const tabs = tabListSchema.parse(
      await client.request("tab.list", { workspace_id: layout.workspaceId }),
    );
    const panes = joinPaneRows(
      layout,
      listed.panes.map((pane) => ({
        paneId: pane.pane_id,
        ...(optionalString(pane.label) === undefined ? {} : { label: pane.label ?? "" }),
        ...(optionalString(pane.agent) === undefined ? {} : { agent: pane.agent ?? "" }),
        ...(optionalString(pane.agent_status) === undefined
          ? {}
          : { status: pane.agent_status ?? "" }),
      })),
    );
    const layoutPaneId =
      source.paneId !== undefined && layout.panes.some((pane) => pane.paneId === source.paneId)
        ? source.paneId
        : layout.panes[0]?.paneId;
    return {
      panes,
      sourceTabId: layout.tabId,
      sourceWorkspaceId: layout.workspaceId,
      tabCount: tabs.tabs.length,
      ...(layoutPaneId === undefined ? {} : { layoutPaneId }),
      ...(layout.focusedPaneId === undefined ? {} : { focusedPaneId: layout.focusedPaneId }),
    };
  } catch (error: unknown) {
    return {
      panes: [],
      tabCount: 0,
      loadError: errorText(error),
    };
  }
}

function closedSource(
  result: ParsedPaneMove,
  sourceTabId: string | undefined,
  sourceWorkspaceId: string | undefined,
): boolean {
  return (
    (sourceTabId !== undefined && result.closedTabId === sourceTabId) ||
    (sourceWorkspaceId !== undefined && result.closedWorkspaceId === sourceWorkspaceId)
  );
}

function failureLine(moved: number, result: ParsedPaneMove): string {
  const closed = [
    result.closedTabId === undefined ? "" : `Closed Herdr tab ${result.closedTabId}.`,
    result.closedWorkspaceId === undefined ? "" : `Closed workspace ${result.closedWorkspaceId}.`,
  ].filter((part) => part !== "");
  const suffix = closed.length === 0 ? "" : ` ${closed.join(" ")}`;
  if (result.reason === "zoomed_tab") {
    return `Moved ${moved}. Unzoom with prefix+z and open the popup again.${suffix}`;
  }
  if (result.reason === "same_tab") {
    return `Moved ${moved}. same_tab. The first call should have created a different Herdr tab.${suffix}`;
  }
  const reason = result.reason === undefined ? "" : ` ${result.reason}.`;
  return `Moved ${moved}.${reason}${suffix}`;
}

async function focusDestination(
  client: WorkspaceClient,
  tabId: string | undefined,
): Promise<string | undefined> {
  if (tabId === undefined) {
    return undefined;
  }
  try {
    await client.request("tab.focus", { tab_id: tabId });
    return undefined;
  } catch (error: unknown) {
    return errorText(error);
  }
}

export async function moveSelectedPanes(
  client: WorkspaceClient,
  request: PaneMoveRequest,
): Promise<PaneMoveOutcome> {
  if (request.topicName.trim() === "") {
    return { close: false, message: "Type the topic name." };
  }
  const moving = [...request.panes]
    .filter((pane) => !request.stayIds.has(pane.paneId))
    .sort((left, right) =>
      compareReadingOrder(
        { ...left.rect, paneId: left.paneId },
        { ...right.rect, paneId: right.paneId },
      ),
    );
  if (moving.length === 0) {
    return { close: false, message: "Nothing to move." };
  }
  if (request.layoutPaneId === undefined) {
    return { close: false, message: "No Herdr tab is available." };
  }

  let fresh: LayoutSnapshot;
  try {
    fresh = await fetchLayout(client, request.layoutPaneId);
  } catch (error: unknown) {
    return { close: false, message: errorText(error) };
  }
  if (fresh.zoomed) {
    return {
      close: false,
      message: "Moved 0. Unzoom with prefix+z and open the popup again.",
    };
  }
  if (
    !samePaneIds(
      fresh.panes.map((pane) => pane.paneId),
      request.panes.map((pane) => pane.paneId),
    ) ||
    (request.sourceTabId !== undefined && fresh.tabId !== request.sourceTabId)
  ) {
    return { close: false, message: "The layout changed. Nothing was moved." };
  }

  let destinationTabId: string | undefined;
  let destinationPanes: readonly LayoutPane[] = [];
  let moved = 0;
  const completed: ParsedPaneMove[] = [];

  const rescue = async (message: string): Promise<PaneMoveOutcome> => {
    const shouldFocus = completed.some((result) =>
      closedSource(result, request.sourceTabId, request.sourceWorkspaceId),
    );
    if (!shouldFocus) {
      return { close: false, message };
    }
    const focusError = await focusDestination(client, destinationTabId);
    if (focusError === undefined) {
      return { close: false, message };
    }
    return { close: false, message: `${message} Could not focus the new Herdr tab. ${focusError}` };
  };

  for (const pane of moving) {
    let params: Record<string, unknown>;
    if (destinationTabId === undefined) {
      params = {
        pane_id: pane.paneId,
        destination:
          request.destination === "workspace"
            ? {
                type: "new_workspace",
                label: request.topicName,
                tab_label: request.topicName,
              }
            : {
                type: "new_tab",
                label: request.topicName,
                ...(request.sourceWorkspaceId === undefined
                  ? {}
                  : { workspace_id: request.sourceWorkspaceId }),
              },
        focus: false,
      };
    } else {
      const target = largestPane(destinationPanes);
      if (target === undefined) {
        return await rescue(`Moved ${moved}. The move response had no destination layout.`);
      }
      params = {
        pane_id: pane.paneId,
        destination: {
          type: "tab",
          tab_id: destinationTabId,
          target_pane_id: target.paneId,
          split: splitDirection(target.rect),
          ratio: 0.5,
        },
        focus: false,
      };
    }

    let raw: Record<string, unknown>;
    try {
      raw = await client.request("pane.move", params);
    } catch (error: unknown) {
      const message =
        error instanceof HerdrError && error.mayHaveSucceeded
          ? `Moved ${moved}. The last request may have succeeded.`
          : `Moved ${moved}. ${errorText(error)}`;
      return await rescue(message);
    }

    const result = mapMove(raw);
    if (result === undefined) {
      return await rescue(`Moved ${moved}. Herdr returned an unexpected pane.move result.`);
    }
    completed.push(result);
    if (!result.changed) {
      return await rescue(failureLine(moved, result));
    }
    moved += 1;
    if (destinationTabId === undefined) {
      if (result.createdTabId === undefined) {
        return await rescue(`Moved ${moved}. The move response had no Herdr tab.`);
      }
      destinationTabId = result.createdTabId;
    }
    if (result.layoutPanes === undefined) {
      return await rescue(`Moved ${moved}. The move response had no destination layout.`);
    }
    destinationPanes = chainPaneIds(result.layoutPanes, result.previousPaneId, result.paneId);
  }

  const focusError = await focusDestination(client, destinationTabId);
  if (focusError !== undefined) {
    return {
      close: false,
      message: `Moved ${moved}. Could not focus the new Herdr tab. ${focusError}`,
    };
  }
  return { close: true, message: "" };
}
