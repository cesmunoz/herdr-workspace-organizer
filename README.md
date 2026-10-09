# Herdr workspace organizer

A Herdr plugin for reviewing and changing the order of workspaces. The plugin ID and repository name
are `herdr-workspace-organizer`.

The popup has three tabs:

- **Manual**: pick a workspace and move it in a draft.
- **Suggested order**: preview your category priorities inside repository trees.
- **Priorities**: add, rename, delete, and reorder categories.

Herdr changes only when you apply a workspace draft. Saving priorities changes the plugin config
only.

## Requirements

- Herdr 0.9.3 or newer
- Node.js 20 or newer and pnpm
- macOS or Linux

## Install

For local development:

```sh
pnpm install
pnpm run build
herdr plugin link "$PWD" --enabled
```

## Open the popup

```sh
herdr plugin pane open --plugin herdr-workspace-organizer --entrypoint organizer --focus
```

Add this binding to `~/.config/herdr/config.toml`:

```toml
[[keys.command]]
key = "prefix+shift+m"
type = "shell"
command = "herdr plugin pane open --plugin herdr-workspace-organizer --entrypoint organizer --focus"
description = "open workspace organizer"
```

Then reload:

```sh
herdr server reload-config
```

Press your prefix, release it, then press Shift+M. Do not use `prefix+w`; that opens Herdr's own
workspace picker.

## Keys

| Key               | Action                                                                          |
| ----------------- | ------------------------------------------------------------------------------- |
| Tab               | Switch tabs                                                                     |
| Up/Down or j/k    | Select an item                                                                  |
| Shift+K / Shift+J | Move a workspace or priority up/down                                            |
| u                 | Reset the Manual draft                                                          |
| a                 | Add a priority                                                                  |
| e                 | Edit a priority                                                                 |
| d                 | Delete a priority                                                               |
| Enter             | Apply the visible workspace draft and close, or save priorities without closing |
| Esc / q           | Cancel and close                                                                |

While you type a category, Enter finishes the text and Esc cancels it. Press Enter again to save the
priorities. Categories are lowercased, and duplicates are rejected.

Colors show why a position changed:

- Cyan **moved**: you moved it yourself.
- Yellow **shifted**: it moved because of another move.
- Green **current**: the focused workspace, with no pending move.

The popup has no outer border. It is 86 columns wide and 72% of the terminal tall; the size does not
follow the content.

## Repository trees

Worktree metadata decides the hierarchy, not the spacing in a label.

```text
app
  feat: search
  chore: tests
notes
```

The panel groups worktrees under their repository root, even when `workspace.list` returns them
elsewhere in the flat list. Root order and the relative order of each root's children are preserved.
Opening the panel, cancelling, or pressing Enter without editing does not change the live order.

Moving `app` moves its displayed children together. Moving a child keeps it among its siblings.
The suggested order sorts children inside each repository tree and leaves the roots in place. A
workspace with no visible repository root is not attached to another root automatically.

## Priority config

Default order:

```text
fix → feat → docs → style → refactor → test → build → chore → revert → hotfix
```

Matching ignores case. A label matches when it equals the category or starts with `category:`. For
example, `FEAT: search` matches `feat`, but `feature: search` does not. Children that match nothing
come after the matched children, in their original relative order.

The panel saves to `$HERDR_PLUGIN_CONFIG_DIR/config.json`. The default location is:

```text
~/.config/herdr/plugins/config/herdr-workspace-organizer/config.json
```

Example:

```json
{
  "order": ["hotfix", "fix", "feat", "chore"]
}
```

Saving writes a temporary file and then renames it. A missing config uses the defaults. A broken
config shows an error and is not replaced silently.

## CLI and actions

```sh
node dist/src/cli.js --help
node dist/src/cli.js up
node dist/src/cli.js down
node dist/src/cli.js sort
node dist/src/cli.js sort --prefixes hotfix,fix,feat
node dist/src/cli.js panel
```

`sort` uses the saved priorities unless you pass `--prefixes`. When worktree metadata exists, it
sorts repository children. When it does not, it keeps the flat-list grouping: unmatched workspaces
at the front stay first, the matched categories form one block, and unmatched workspaces after them
follow.

Direct actions change the order right away, unlike the popup, which waits for confirmation:

```sh
herdr plugin action invoke workspace-up --plugin herdr-workspace-organizer
herdr plugin action invoke workspace-down --plugin herdr-workspace-organizer
herdr plugin action invoke sort-workspaces --plugin herdr-workspace-organizer
herdr plugin log list --plugin herdr-workspace-organizer
```

Movement actions use the workspace that Herdr passes in. If you run the script yourself, it uses
`HERDR_WORKSPACE_ID` from that pane.

## Development

```sh
pnpm install
pnpm run validate
pnpm run format
```

See `AGENTS.md` for the rules that must not change and contribution limits.
Aside from installing packages, the plugin downloads nothing at runtime.

## Safety and limits

The plugin does not rename, close, or focus workspaces to reorder them. Moving past an edge does
nothing. Socket requests time out after five seconds. Failed changes are not retried.

Current limits:

- A draft does not detect changes from other clients before it is applied.
- Long lists do not scroll, so small terminals can cut off content.
- Tree grouping requires the repository root to be visible; orphan worktrees stay standalone.
- Some legacy rendering still uses raw ANSI styling next to Chalk.

Live testing changes your session. Prefer the automated tests. Run live movement tests only with
permission, and restore the original order afterward.
