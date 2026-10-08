export type Workspace = Readonly<{
  workspaceId: string;
  label: string;
  worktree?: Readonly<{
    repoKey: string;
    repoRoot: string;
    checkoutPath: string;
    isLinked: boolean;
  }>;
}>;

export type MoveBlockParams = Readonly<{
  workspace_ids: readonly string[];
  before_workspace_id: string | null;
}>;

export interface WorkspaceClient {
  workspaces(): Promise<readonly Workspace[]>;
  request(
    method: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>>;
}
