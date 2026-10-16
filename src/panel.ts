import chalk from "chalk";
import stringWidth from "string-width";
import sliceAnsi from "slice-ansi";
import { suggestedOrder } from "./ordering.js";
import { emitKeypressEvents } from "node:readline";
import type { Key } from "node:readline";
import { configPath, loadConfig, saveConfig } from "./config.js";
import { reorderWorkspace, workspaceDepth, workspaceTreeOrder } from "./core.js";
import {
  loadPaneTab,
  moveSelectedPanes,
  paneStatusLine,
  type PaneDestination,
  type PaneRow,
  type PaneTabSnapshot,
} from "./panes.js";
import { normalizeOrder } from "./utils.js";
import type { Workspace, WorkspaceClient } from "./types.js";

const ansi = {
  clear: "\u001b[2J\u001b[H",
  hideCursor: "\u001b[?25l",
  showCursor: "\u001b[?25h",
  reset: "\u001b[0m",
  selected: "\u001b[48;5;237m",
} as const;

const tabs = ["manual", "suggested", "configure", "panes"] as const;
export type Tab = (typeof tabs)[number];
type EditMode = Readonly<{ kind: "add" | "rename" | "topic"; value: string }> | undefined;

export type PanelState = {
  tab: Tab;
  original: readonly Workspace[];
  manualDraft: readonly Workspace[];
  suggestedDraft: readonly Workspace[];
  selectedId: string | undefined;
  directlyMovedIds: ReadonlySet<string>;
  order: readonly string[];
  savedOrder: readonly string[];
  categoryIndex: number;
  editMode: EditMode;
  message: string;
  panes: readonly PaneRow[];
  paneIndex: number;
  stayIds: ReadonlySet<string>;
  destination: PaneDestination;
  topicName: string;
  sourceTabId: string | undefined;
  sourceWorkspaceId: string | undefined;
  layoutPaneId: string | undefined;
  tabCount: number;
  paneLoadError: string | undefined;
};

export type PanelKey = Readonly<{
  name?: string | undefined;
  ctrl?: boolean | undefined;
  meta?: boolean | undefined;
  shift?: boolean | undefined;
}>;

export type PanelEffect =
  | { readonly kind: "none" }
  | { readonly kind: "close" }
  | { readonly kind: "apply-workspaces" }
  | { readonly kind: "save-priorities" }
  | { readonly kind: "move-panes" };

const noEffect = { kind: "none" } as const;

function sameOrder(left: readonly Workspace[], right: readonly Workspace[]): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => item.workspaceId === right[index]?.workspaceId)
  );
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function changedIds(
  original: readonly Workspace[],
  draft: readonly Workspace[],
): ReadonlySet<string> {
  return new Set(
    draft
      .filter((item, index) => original[index]?.workspaceId !== item.workspaceId)
      .map((item) => item.workspaceId),
  );
}

function fit(value: string, width: number): string {
  const visible = stringWidth(value);
  return visible >= width
    ? `${sliceAnsi(value, 0, Math.max(0, width - 1))}…`
    : value + " ".repeat(width - visible);
}

function tabLabel(active: boolean, label: string): string {
  return active ? chalk.cyan.bold(` ${label.toUpperCase()} `) : chalk.dim(` ${label} `);
}

function done(state: PanelState, effect: PanelEffect = noEffect) {
  return { state, effect };
}

export function createPanelState(input: {
  original: readonly Workspace[];
  order: readonly string[];
  focusedId: string | undefined;
  paneTab?: PaneTabSnapshot;
}): PanelState {
  const paneTab: PaneTabSnapshot = input.paneTab ?? { panes: [], tabCount: 0 };
  const found = paneTab.focusedPaneId
    ? paneTab.panes.findIndex((pane) => pane.paneId === paneTab.focusedPaneId)
    : 0;
  return {
    tab: "manual",
    original: input.original,
    manualDraft: [...input.original],
    suggestedDraft: suggestedOrder(input.original, input.order),
    selectedId:
      input.original.find((item) => item.workspaceId === input.focusedId)?.workspaceId ??
      input.original[0]?.workspaceId,
    directlyMovedIds: new Set(),
    order: input.order,
    savedOrder: input.order,
    categoryIndex: 0,
    editMode: undefined,
    message: "",
    panes: paneTab.panes,
    paneIndex: found < 0 ? 0 : found,
    stayIds: new Set(),
    destination: "tab",
    topicName: "",
    sourceTabId: paneTab.sourceTabId,
    sourceWorkspaceId: paneTab.sourceWorkspaceId,
    layoutPaneId: paneTab.layoutPaneId,
    tabCount: paneTab.tabCount,
    paneLoadError: paneTab.loadError,
  };
}

function renderWorkspaceRows(
  state: PanelState,
  focusedId: string | undefined,
  width: number,
  margin: string,
): void {
  const draft = state.tab === "manual" ? state.manualDraft : state.suggestedDraft;
  const changed = changedIds(state.original, draft);
  for (const [index, workspace] of draft.entries()) {
    const selected = workspace.workspaceId === state.selectedId;
    const directlyMoved =
      state.tab === "manual" &&
      changed.has(workspace.workspaceId) &&
      state.directlyMovedIds.has(workspace.workspaceId);
    const shifted = changed.has(workspace.workspaceId) && !directlyMoved;
    const focused = workspace.workspaceId === focusedId;
    const tree = workspaceDepth(draft, index) === 1 ? `${chalk.dim("└─")} ` : "";
    const status = directlyMoved
      ? chalk.cyan("moved")
      : shifted
        ? chalk.yellow("shifted")
        : focused
          ? chalk.green("current")
          : "";
    const color = (text: string): string => {
      if (directlyMoved) {
        return chalk.cyan(text);
      }
      if (shifted) {
        return chalk.yellow(text);
      }
      if (selected) {
        return chalk.white(text);
      }
      return text;
    };
    const row = `${selected ? chalk.cyan("›") : " "} ${chalk.dim(String(index + 1).padStart(2, "0"))}  ${tree}${color(workspace.label || workspace.workspaceId)}`;
    const content = `${fit(row, Math.max(16, width - stringWidth(status) - 3))}${status ? `   ${status}` : ""}`;
    process.stdout.write(
      `${selected ? ansi.selected : ""}${margin}${fit(content, width)}${ansi.reset}\n`,
    );
  }
}

function renderCategories(state: PanelState, width: number, margin: string): void {
  process.stdout.write(
    `${margin}${chalk.dim("These priorities sort children within each workspace tree.")}\n\n`,
  );
  state.order.forEach((category, index) => {
    const selected = index === state.categoryIndex;
    const renameEdit = state.editMode?.kind === "rename" ? state.editMode : undefined;
    const editing = selected && renameEdit !== undefined;
    const value = editing ? `${renameEdit.value}${chalk.cyan("▌")}` : category;
    const row = `${selected ? chalk.cyan("›") : " "} ${chalk.dim(String(index + 1).padStart(2, "0"))}  ${selected ? chalk.white(value) : value}`;
    process.stdout.write(
      `${selected ? ansi.selected : ""}${margin}${fit(row, width)}${ansi.reset}\n`,
    );
  });
  if (state.editMode?.kind === "add") {
    process.stdout.write(
      `${ansi.selected}${margin}${fit(`${chalk.cyan("+")}     ${state.editMode.value}${chalk.cyan("▌")}`, width)}${ansi.reset}\n`,
    );
  }
}

function renderPaneRows(state: PanelState, width: number, margin: string): void {
  const destination = state.destination === "tab" ? "new Herdr tab" : "new workspace";
  const topicEdit = state.editMode?.kind === "topic" ? state.editMode : undefined;
  const name =
    topicEdit !== undefined
      ? `${topicEdit.value}${chalk.cyan("▌")}`
      : state.topicName === ""
        ? chalk.dim("empty")
        : state.topicName;
  process.stdout.write(`${margin}${chalk.dim("Destination")}  ${destination}\n`);
  process.stdout.write(`${margin}${chalk.dim("Name")}         ${name}\n\n`);
  if (state.panes.length === 0) {
    process.stdout.write(`${margin}${chalk.dim("This Herdr tab has no panes.")}\n`);
    return;
  }
  for (const [index, pane] of state.panes.entries()) {
    const selected = index === state.paneIndex;
    const stay = state.stayIds.has(pane.paneId);
    const agent = pane.agent === "" ? "" : `  ${chalk.dim(pane.agent)}`;
    const marks = [pane.status === "" ? "" : chalk.dim(pane.status), stay ? "stay" : ""]
      .filter((part) => part !== "")
      .join("  ");
    const row = `${selected ? chalk.cyan("›") : " "} ${chalk.dim(String(index + 1).padStart(2, "0"))}  ${selected ? chalk.white(pane.label) : pane.label}${agent}`;
    const content = `${fit(row, Math.max(16, width - stringWidth(marks) - 3))}${marks === "" ? "" : `   ${marks}`}`;
    process.stdout.write(
      `${selected ? ansi.selected : ""}${margin}${fit(content, width)}${ansi.reset}\n`,
    );
  }
}

function render(state: PanelState, focusedId: string | undefined): void {
  const terminalWidth = process.stdout.columns ?? 86;
  const width = Math.max(50, terminalWidth - 10);
  const margin = "    ";
  const subtitle =
    state.tab === "panes"
      ? "Mark who stays, then move the rest"
      : "Prepare the order, review it, then confirm";
  process.stdout.write(
    `${ansi.clear}${ansi.hideCursor}\n${margin}${chalk.bold.white("Organize workspaces")}\n`,
  );
  process.stdout.write(`${margin}${chalk.dim(subtitle)}\n\n`);
  process.stdout.write(
    `${margin}${tabLabel(state.tab === "manual", "Manual")}   ${tabLabel(state.tab === "suggested", "Suggested order")}   ${tabLabel(state.tab === "configure", "Priorities")}   ${tabLabel(state.tab === "panes", "Move panes")}\n`,
  );
  process.stdout.write(`${margin}${chalk.dim("─".repeat(Math.min(width, 72)))}\n\n`);

  if (state.tab === "configure") {
    renderCategories(state, width, margin);
  } else if (state.tab === "panes") {
    renderPaneRows(state, width, margin);
  } else {
    renderWorkspaceRows(state, focusedId, width, margin);
  }

  process.stdout.write(`\n${margin}${chalk.dim("─".repeat(Math.min(width, 72)))}\n`);
  if (state.tab === "manual") {
    process.stdout.write(
      `${margin}${chalk.bold("↑↓")} select   ${chalk.bold("K J")} move block   ${chalk.bold("U")} reset\n`,
    );
  }
  if (state.tab === "suggested") {
    process.stdout.write(`${margin}${chalk.dim(`Preview using: ${state.order.join(" → ")}`)}\n`);
  }
  if (state.tab === "configure") {
    process.stdout.write(
      `${margin}${chalk.bold("↑↓")} select   ${chalk.bold("K J")} priority   ${chalk.bold("A")} add   ${chalk.bold("E")} rename   ${chalk.bold("D")} delete\n`,
    );
  }
  if (state.tab === "panes") {
    process.stdout.write(
      `${margin}${chalk.bold("↑↓")} select   ${chalk.bold("Space")} stay   ${chalk.bold("S")} destination   ${chalk.bold("N")} name   ${chalk.bold("X")} clear\n`,
    );
  }
  const enterLabel = state.tab === "configure" ? "save" : state.tab === "panes" ? "move" : "apply";
  process.stdout.write(
    `${margin}${chalk.green.bold(`Enter ${enterLabel}`)}   ${chalk.bold("Tab")} switch tab   ${chalk.bold("Esc")} cancel\n\n`,
  );

  if (state.tab === "panes") {
    const summary = paneStatusLine({
      panes: state.panes,
      stayIds: state.stayIds,
      destination: state.destination,
      topicName: state.topicName,
      tabCount: state.tabCount,
      ...(state.paneLoadError === undefined ? {} : { loadError: state.paneLoadError }),
    });
    process.stdout.write(`${margin}${state.message || summary}\n`);
    return;
  }

  const dirty =
    state.tab === "configure"
      ? !sameStrings(state.order, state.savedOrder)
      : !sameOrder(
          state.tab === "manual" ? state.manualDraft : state.suggestedDraft,
          state.original,
        );
  const summary = dirty
    ? `${chalk.yellow("Unsaved changes")}`
    : `${chalk.dim("No pending changes")}`;
  process.stdout.write(`${margin}${state.message || summary}\n`);
}

function activeDraft(state: PanelState): readonly Workspace[] {
  return state.tab === "manual" ? state.manualDraft : state.suggestedDraft;
}

function selectWorkspace(state: PanelState, offset: -1 | 1): PanelState {
  const draft = activeDraft(state);
  const current = Math.max(
    0,
    draft.findIndex((item) => item.workspaceId === state.selectedId),
  );
  const next = Math.max(0, Math.min(draft.length - 1, current + offset));
  return { ...state, selectedId: draft[next]?.workspaceId, message: "" };
}

function moveDraft(state: PanelState, offset: -1 | 1): PanelState {
  if (state.selectedId === undefined) {
    return state;
  }
  const next = reorderWorkspace(state.manualDraft, state.selectedId, offset);
  if (next === state.manualDraft) {
    return { ...state, message: "That workspace is already at the edge of its group." };
  }
  const directlyMovedIds = new Set(state.directlyMovedIds);
  directlyMovedIds.add(state.selectedId);
  const stillChanged = changedIds(state.original, next);
  return {
    ...state,
    manualDraft: next,
    directlyMovedIds: new Set([...directlyMovedIds].filter((id) => stillChanged.has(id))),
    message: "Draft updated. Cyan was moved directly; yellow shifted as a result.",
  };
}

function moveCategory(state: PanelState, offset: -1 | 1): PanelState {
  const target = state.categoryIndex + offset;
  if (target < 0 || target >= state.order.length) {
    return state;
  }
  const order = [...state.order];
  const [category] = order.splice(state.categoryIndex, 1);
  if (category === undefined) {
    return state;
  }
  order.splice(target, 0, category);
  return {
    ...state,
    order,
    categoryIndex: target,
    suggestedDraft: suggestedOrder(state.original, order),
    message: "Priority updated.",
  };
}

function commitEdit(state: PanelState): PanelState {
  const edit = state.editMode;
  if (edit === undefined) {
    return state;
  }
  if (edit.kind === "topic") {
    return { ...state, topicName: edit.value, editMode: undefined, message: "" };
  }
  const normalized = normalizeOrder([edit.value])[0];
  if (normalized === undefined) {
    return { ...state, editMode: undefined, message: "The category cannot be empty." };
  }
  if (edit.kind === "add") {
    if (state.order.includes(normalized)) {
      return { ...state, editMode: undefined, message: "That category already exists." };
    }
    const order = [...state.order, normalized];
    return {
      ...state,
      order,
      categoryIndex: order.length - 1,
      editMode: undefined,
      suggestedDraft: suggestedOrder(state.original, order),
      message: "Category added.",
    };
  }
  if (state.order.some((item, index) => item === normalized && index !== state.categoryIndex)) {
    return { ...state, editMode: undefined, message: "That category already exists." };
  }
  const order = state.order.map((item, index) =>
    index === state.categoryIndex ? normalized : item,
  );
  return {
    ...state,
    order,
    editMode: undefined,
    suggestedDraft: suggestedOrder(state.original, order),
    message: "Category renamed.",
  };
}

function movePaneSelection(state: PanelState, offset: -1 | 1): PanelState {
  if (state.panes.length === 0) {
    return { ...state, message: "" };
  }
  const next = Math.max(0, Math.min(state.panes.length - 1, state.paneIndex + offset));
  return { ...state, paneIndex: next, message: "" };
}

function toggleStay(state: PanelState): PanelState {
  const pane = state.panes[state.paneIndex];
  if (pane === undefined) {
    return state;
  }
  const stayIds = new Set(state.stayIds);
  if (stayIds.has(pane.paneId)) {
    stayIds.delete(pane.paneId);
  } else {
    stayIds.add(pane.paneId);
  }
  return { ...state, stayIds, message: "" };
}

function enterOnPanes(state: PanelState): { state: PanelState; effect: PanelEffect } {
  if (state.topicName.trim() === "") {
    return done({
      ...state,
      editMode: { kind: "topic", value: state.topicName },
      message: "Type the topic name.",
    });
  }
  const moving = state.panes.some((pane) => !state.stayIds.has(pane.paneId));
  if (!moving) {
    if (state.paneLoadError !== undefined && state.panes.length === 0) {
      return done({ ...state, message: state.paneLoadError });
    }
    return done({ ...state, message: "Nothing to move." });
  }
  if (state.paneLoadError !== undefined) {
    return done({ ...state, message: state.paneLoadError });
  }
  return done(state, { kind: "move-panes" });
}

export function applyPanelKey(
  state: PanelState,
  input: string | undefined,
  key: PanelKey,
): { readonly state: PanelState; readonly effect: PanelEffect } {
  if (state.editMode !== undefined) {
    if (state.editMode.kind === "topic" && key.ctrl && key.name === "c") {
      return done(state, { kind: "close" });
    }
    if (key.name === "escape") {
      return done({ ...state, editMode: undefined, message: "Edit cancelled." });
    }
    if (key.name === "return") {
      return done(commitEdit(state));
    }
    if (key.name === "backspace") {
      return done({
        ...state,
        editMode: { ...state.editMode, value: state.editMode.value.slice(0, -1) },
      });
    }
    if (!key.ctrl && !key.meta && input && input >= " ") {
      return done({
        ...state,
        editMode: { ...state.editMode, value: state.editMode.value + input },
      });
    }
    return done(state);
  }
  if ((key.ctrl && key.name === "c") || key.name === "q" || key.name === "escape") {
    return done(state, { kind: "close" });
  }
  if (key.name === "tab") {
    const tab = tabs[(tabs.indexOf(state.tab) + 1) % tabs.length] ?? "manual";
    return done({ ...state, tab, message: "" });
  }
  if (key.name === "up" || (key.name === "k" && !key.shift)) {
    if (state.tab === "configure") {
      return done({ ...state, categoryIndex: Math.max(0, state.categoryIndex - 1), message: "" });
    }
    if (state.tab === "panes") {
      return done(movePaneSelection(state, -1));
    }
    return done(selectWorkspace(state, -1));
  }
  if (key.name === "down" || (key.name === "j" && !key.shift)) {
    if (state.tab === "configure") {
      return done({
        ...state,
        categoryIndex: Math.min(state.order.length - 1, state.categoryIndex + 1),
        message: "",
      });
    }
    if (state.tab === "panes") {
      return done(movePaneSelection(state, 1));
    }
    return done(selectWorkspace(state, 1));
  }
  if (state.tab === "manual" && key.name === "k" && key.shift) {
    return done(moveDraft(state, -1));
  }
  if (state.tab === "manual" && key.name === "j" && key.shift) {
    return done(moveDraft(state, 1));
  }
  if (state.tab === "manual" && key.name === "u") {
    return done({
      ...state,
      manualDraft: [...state.original],
      directlyMovedIds: new Set(),
      message: "Draft reset.",
    });
  }
  if (state.tab === "configure" && key.name === "k" && key.shift) {
    return done(moveCategory(state, -1));
  }
  if (state.tab === "configure" && key.name === "j" && key.shift) {
    return done(moveCategory(state, 1));
  }
  if (state.tab === "configure" && key.name === "a") {
    return done({
      ...state,
      editMode: { kind: "add", value: "" },
      message: "Type the new category.",
    });
  }
  if (state.tab === "configure" && key.name === "e") {
    return done({
      ...state,
      editMode: { kind: "rename", value: state.order[state.categoryIndex] ?? "" },
      message: "Edit the category.",
    });
  }
  if (state.tab === "configure" && key.name === "d") {
    if (state.order.length <= 1) {
      return done({ ...state, message: "At least one category is required." });
    }
    const order = state.order.filter((_item, index) => index !== state.categoryIndex);
    return done({
      ...state,
      order,
      categoryIndex: Math.min(state.categoryIndex, order.length - 1),
      suggestedDraft: suggestedOrder(state.original, order),
      message: "Category deleted.",
    });
  }
  if (state.tab === "panes" && (key.name === "space" || input === " ")) {
    return done(toggleStay(state));
  }
  if (state.tab === "panes" && key.name === "s" && !key.ctrl && !key.meta) {
    return done({
      ...state,
      destination: state.destination === "tab" ? "workspace" : "tab",
      message: "",
    });
  }
  if (state.tab === "panes" && key.name === "n" && !key.ctrl && !key.meta) {
    return done({
      ...state,
      editMode: { kind: "topic", value: state.topicName },
      message: "Edit the topic name.",
    });
  }
  if (state.tab === "panes" && key.name === "x" && !key.ctrl && !key.meta) {
    return done({ ...state, stayIds: new Set(), message: "" });
  }
  if (key.name === "return") {
    if (state.tab === "configure") {
      return done(state, { kind: "save-priorities" });
    }
    if (state.tab === "panes") {
      return enterOnPanes(state);
    }
    return done(state, { kind: "apply-workspaces" });
  }
  return done(state);
}

export async function runPanel(
  client: WorkspaceClient,
  focusedId: string | undefined,
): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error("workspace organizer requires an interactive terminal");
  }
  const path = configPath();
  const config = await loadConfig(path);
  let original = workspaceTreeOrder(await client.workspaces());
  const paneTab = await loadPaneTab(client, process.env);
  let state = createPanelState({
    original,
    order: config.order,
    focusedId,
    paneTab,
  });
  let busy = false;
  const update = (patch: Partial<PanelState>): void => {
    state = { ...state, ...patch };
  };
  const applyWorkspaces = async (): Promise<boolean> => {
    const draft = activeDraft(state);
    if (sameOrder(draft, original)) {
      return false;
    }
    await client.request("workspace.move_block", {
      workspace_ids: draft.map((item) => item.workspaceId),
      before_workspace_id: null,
    });
    original = workspaceTreeOrder(await client.workspaces());
    update({
      original,
      manualDraft: [...original],
      suggestedDraft: suggestedOrder(original, state.order),
      directlyMovedIds: new Set(),
    });
    return true;
  };
  const savePriorities = async (): Promise<void> => {
    await saveConfig(path, { order: state.order });
    update({
      savedOrder: state.order,
      suggestedDraft: suggestedOrder(original, state.order),
      message: "Priorities saved.",
    });
  };
  const movePanes = async (): Promise<boolean> => {
    const outcome = await moveSelectedPanes(client, {
      panes: state.panes,
      stayIds: state.stayIds,
      destination: state.destination,
      topicName: state.topicName,
      ...(state.sourceTabId === undefined ? {} : { sourceTabId: state.sourceTabId }),
      ...(state.sourceWorkspaceId === undefined
        ? {}
        : { sourceWorkspaceId: state.sourceWorkspaceId }),
      ...(state.layoutPaneId === undefined ? {} : { layoutPaneId: state.layoutPaneId }),
    });
    update({ message: outcome.message });
    return outcome.close;
  };
  const cleanup = (): void => {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write(ansi.showCursor);
  };

  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  render(state, focusedId);
  await new Promise<void>((resolve) => {
    process.stdin.on("keypress", (input: string, key: Key) => {
      if (busy) {
        return;
      }
      const next = applyPanelKey(state, input, key);
      state = next.state;
      if (next.effect.kind === "close") {
        cleanup();
        resolve();
        return;
      }
      if (next.effect.kind === "none") {
        render(state, focusedId);
        return;
      }
      busy = true;
      const operation =
        next.effect.kind === "save-priorities"
          ? savePriorities().then(() => false)
          : next.effect.kind === "move-panes"
            ? movePanes()
            : applyWorkspaces();
      operation
        .then((changed) => {
          if (changed) {
            cleanup();
            resolve();
          }
        })
        .catch((error: unknown) =>
          update({ message: error instanceof Error ? error.message : String(error) }),
        )
        .finally(() => {
          busy = false;
          if (process.stdin.isRaw) {
            render(state, focusedId);
          }
        });
    });
  });
}
