import { z } from "zod";

export const recordSchema = z.record(z.string(), z.unknown());
export const responseSchema = z.object({
  id: z.string(),
  result: recordSchema.optional(),
  error: z.unknown().optional(),
});

const worktreeSchema = z
  .object({
    repo_key: z.string(),
    repo_root: z.string(),
    checkout_path: z.string(),
    is_linked_worktree: z.boolean(),
  })
  .transform((value) => ({
    repoKey: value.repo_key,
    repoRoot: value.repo_root,
    checkoutPath: value.checkout_path,
    isLinked: value.is_linked_worktree,
  }));

export const workspaceListSchema = z.object({
  workspaces: z.array(
    z
      .object({
        workspace_id: z.string(),
        label: z.string().nullish(),
        worktree: worktreeSchema.nullish(),
      })
      .transform((value) => ({
        workspaceId: value.workspace_id,
        label: value.label ?? "",
        ...(value.worktree == null ? {} : { worktree: value.worktree }),
      })),
  ),
});

export const configSchema = z.object({
  order: z.array(z.string().trim().toLowerCase().min(1)).min(1),
});
export type PluginConfig = z.infer<typeof configSchema>;

export const pluginContextSchema = z.object({
  workspace_id: z.string().optional(),
  tab_id: z.string().optional(),
  focused_pane_id: z.string().optional(),
});

const paneRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

const layoutPaneSchema = z.object({
  pane_id: z.string(),
  rect: paneRectSchema,
});

export const paneLayoutSchema = z.object({
  workspace_id: z.string(),
  tab_id: z.string(),
  zoomed: z.boolean(),
  focused_pane_id: z.string().optional(),
  panes: z.array(layoutPaneSchema),
});

const paneInfoSchema = z.object({
  pane_id: z.string(),
  tab_id: z.string().optional(),
  label: z.string().nullish(),
  agent: z.string().nullish(),
  agent_status: z.string().optional(),
});

export const paneListSchema = z.object({
  panes: z.array(paneInfoSchema),
});

export const tabListSchema = z.object({
  tabs: z.array(z.object({ tab_id: z.string() })),
});

export const paneMoveSchema = z.object({
  changed: z.boolean(),
  reason: z.string().nullish(),
  previous_pane_id: z.string().optional(),
  pane: z.object({ pane_id: z.string() }),
  target_layout: paneLayoutSchema.optional(),
  created_tab: z
    .object({
      tab_id: z.string(),
    })
    .nullish(),
  closed_tab_id: z.string().nullish(),
  closed_workspace_id: z.string().nullish(),
});
