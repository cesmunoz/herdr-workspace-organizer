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
