import chalk from "chalk";
import stringWidth from "string-width";
import sliceAnsi from "slice-ansi";
import { suggestedOrder } from "./ordering.js";
import { emitKeypressEvents } from "node:readline";
import type { Key } from "node:readline";
import { configPath, loadConfig, saveConfig } from "./config.js";
import { reorderWorkspace, workspaceDepth, workspaceTreeOrder } from "./core.js";
import { normalizeOrder } from "./utils.js";
import type { Workspace, WorkspaceClient } from "./types.js";

const ansi = {
  clear: "\u001b[2J\u001b[H",
  hideCursor: "\u001b[?25l",
  showCursor: "\u001b[?25h",
  reset: "\u001b[0m",
  selected: "\u001b[48;5;237m",
} as const;

type Tab = "manual" | "suggested" | "configure";
type EditMode = Readonly<{ kind: "add" | "rename"; value: string }> | undefined;
type PanelState = {
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
};

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

function render(state: PanelState, focusedId: string | undefined): void {
  const terminalWidth = process.stdout.columns ?? 86;
  const width = Math.max(50, terminalWidth - 10);
  const margin = "    ";
  process.stdout.write(
    `${ansi.clear}${ansi.hideCursor}\n${margin}${chalk.bold.white("Organize workspaces")}\n`,
  );
  process.stdout.write(`${margin}${chalk.dim("Prepare the order, review it, then confirm")}\n\n`);
  process.stdout.write(
    `${margin}${tabLabel(state.tab === "manual", "Manual")}   ${tabLabel(state.tab === "suggested", "Suggested order")}   ${tabLabel(state.tab === "configure", "Priorities")}\n`,
  );
  process.stdout.write(`${margin}${chalk.dim("─".repeat(Math.min(width, 72)))}\n\n`);

  if (state.tab === "configure") {
    renderCategories(state, width, margin);
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
  process.stdout.write(
    `${margin}${chalk.green.bold(`Enter ${state.tab === "configure" ? "save" : "apply"}`)}   ${chalk.bold("Tab")} switch tab   ${chalk.bold("Esc")} cancel\n\n`,
  );

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
  let state: PanelState = {
    tab: "manual",
    original,
    manualDraft: [...original],
    suggestedDraft: suggestedOrder(original, config.order),
    selectedId:
      original.find((item) => item.workspaceId === focusedId)?.workspaceId ??
      original[0]?.workspaceId,
    directlyMovedIds: new Set(),
    order: config.order,
    savedOrder: config.order,
    categoryIndex: 0,
    editMode: undefined,
    message: "",
  };
  let busy = false;
  const update = (patch: Partial<PanelState>): void => {
    state = { ...state, ...patch };
  };
  const activeDraft = (): readonly Workspace[] =>
    state.tab === "manual" ? state.manualDraft : state.suggestedDraft;

  const selectWorkspace = (offset: -1 | 1): void => {
    const draft = activeDraft();
    const current = Math.max(
      0,
      draft.findIndex((item) => item.workspaceId === state.selectedId),
    );
    const next = Math.max(0, Math.min(draft.length - 1, current + offset));
    update({ selectedId: draft[next]?.workspaceId, message: "" });
  };
  const moveDraft = (offset: -1 | 1): void => {
    if (state.selectedId === undefined) {
      return;
    }
    const next = reorderWorkspace(state.manualDraft, state.selectedId, offset);
    if (next === state.manualDraft) {
      return update({ message: "That workspace is already at the edge of its group." });
    }
    const directlyMovedIds = new Set(state.directlyMovedIds);
    directlyMovedIds.add(state.selectedId);
    const stillChanged = changedIds(original, next);
    update({
      manualDraft: next,
      directlyMovedIds: new Set([...directlyMovedIds].filter((id) => stillChanged.has(id))),
      message: "Draft updated. Cyan was moved directly; yellow shifted as a result.",
    });
  };
  const moveCategory = (offset: -1 | 1): void => {
    const target = state.categoryIndex + offset;
    if (target < 0 || target >= state.order.length) {
      return;
    }
    const order = [...state.order];
    const [category] = order.splice(state.categoryIndex, 1);
    if (category === undefined) {
      return;
    }
    order.splice(target, 0, category);
    update({
      order,
      categoryIndex: target,
      suggestedDraft: suggestedOrder(original, order),
      message: "Priority updated.",
    });
  };
  const commitEdit = (): void => {
    const edit = state.editMode;
    if (edit === undefined) {
      return;
    }
    const normalized = normalizeOrder([edit.value])[0];
    if (normalized === undefined) {
      return update({ editMode: undefined, message: "The category cannot be empty." });
    }
    if (edit.kind === "add") {
      if (state.order.includes(normalized)) {
        return update({ editMode: undefined, message: "That category already exists." });
      }
      const order = [...state.order, normalized];
      update({
        order,
        categoryIndex: order.length - 1,
        editMode: undefined,
        suggestedDraft: suggestedOrder(original, order),
        message: "Category added.",
      });
    } else {
      if (state.order.some((item, index) => item === normalized && index !== state.categoryIndex)) {
        return update({ editMode: undefined, message: "That category already exists." });
      }
      const order = state.order.map((item, index) =>
        index === state.categoryIndex ? normalized : item,
      );
      update({
        order,
        editMode: undefined,
        suggestedDraft: suggestedOrder(original, order),
        message: "Category renamed.",
      });
    }
  };
  const applyWorkspaces = async (): Promise<boolean> => {
    const draft = activeDraft();
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
      if (state.editMode !== undefined) {
        if (key.name === "escape") {
          update({ editMode: undefined, message: "Edit cancelled." });
        } else if (key.name === "return") {
          commitEdit();
        } else if (key.name === "backspace") {
          update({ editMode: { ...state.editMode, value: state.editMode.value.slice(0, -1) } });
        } else if (!key.ctrl && !key.meta && input && input >= " ") {
          update({ editMode: { ...state.editMode, value: state.editMode.value + input } });
        }
        render(state, focusedId);
        return;
      }
      if ((key.ctrl && key.name === "c") || key.name === "q" || key.name === "escape") {
        cleanup();
        resolve();
        return;
      }
      if (key.name === "tab") {
        const tabs: readonly Tab[] = ["manual", "suggested", "configure"];
        const tab = tabs[(tabs.indexOf(state.tab) + 1) % tabs.length] ?? "manual";
        update({ tab, message: "" });
      } else if (key.name === "up" || (key.name === "k" && !key.shift)) {
        if (state.tab === "configure") {
          update({ categoryIndex: Math.max(0, state.categoryIndex - 1), message: "" });
        } else {
          selectWorkspace(-1);
        }
      } else if (key.name === "down" || (key.name === "j" && !key.shift)) {
        if (state.tab === "configure") {
          update({
            categoryIndex: Math.min(state.order.length - 1, state.categoryIndex + 1),
            message: "",
          });
        } else {
          selectWorkspace(1);
        }
      } else if (state.tab === "manual" && key.name === "k" && key.shift) {
        moveDraft(-1);
      } else if (state.tab === "manual" && key.name === "j" && key.shift) {
        moveDraft(1);
      } else if (state.tab === "manual" && key.name === "u") {
        update({
          manualDraft: [...original],
          directlyMovedIds: new Set(),
          message: "Draft reset.",
        });
      } else if (state.tab === "configure" && key.name === "k" && key.shift) {
        moveCategory(-1);
      } else if (state.tab === "configure" && key.name === "j" && key.shift) {
        moveCategory(1);
      } else if (state.tab === "configure" && key.name === "a") {
        update({ editMode: { kind: "add", value: "" }, message: "Type the new category." });
      } else if (state.tab === "configure" && key.name === "e") {
        update({
          editMode: { kind: "rename", value: state.order[state.categoryIndex] ?? "" },
          message: "Edit the category.",
        });
      } else if (state.tab === "configure" && key.name === "d") {
        if (state.order.length <= 1) {
          update({ message: "At least one category is required." });
        } else {
          const order = state.order.filter((_item, index) => index !== state.categoryIndex);
          update({
            order,
            categoryIndex: Math.min(state.categoryIndex, order.length - 1),
            suggestedDraft: suggestedOrder(original, order),
            message: "Category deleted.",
          });
        }
      } else if (key.name === "return") {
        busy = true;
        const operation =
          state.tab === "configure" ? savePriorities().then(() => false) : applyWorkspaces();
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
        return;
      }
      render(state, focusedId);
    });
  });
}
