# Project guide

## What this project is

This repo is a Herdr plugin that organizes workspaces. The installed ID is
`herdr-workspace-organizer`. Keep that ID, the config path, the action IDs, and the user's key
bindings the same unless someone asks for a migration. The old ID was `herdr-move-panels`. The
migration steps are in README.md. The local folder may still be named `herdr-move-panels`.

The plugin works with Herdr 0.9.3 and Node.js 20 or newer. TypeScript compiles to ESM JavaScript,
and imports use `.js` endings. The plugin has runtime dependencies. Do not depend on tsx, Bun, or a
globally installed TypeScript.

## Commands

- `pnpm install`: install from the lockfile.
- `pnpm run build`: compile into `dist/`.
- `pnpm run validate`: typecheck, lint, check formatting, compile, and test.
- `pnpm run format`: format with Oxfmt.
- `pnpm test`: run tests with node:test, including tests against a real local Unix socket.

Run `pnpm run validate` before you finish code changes. Do not stage, commit, or throw away another
person's changes unless asked.

## What each file owns

- `src/cli.ts`: Commander commands, process environment, CLI errors.
- `src/client.ts`: newline-delimited JSON socket transport and connection cleanup.
- `src/schemas.ts`: Zod checks at the socket and config boundaries.
- `src/config.ts`: where the config lives, how it is cleaned up, loaded, and saved without partial
  writes. Effect handles file errors here.
- `src/core.ts`: movement, tree grouping, prefix matching, and reorder plans.
- `src/ordering.ts`: the suggested priority order shared by the panel and the tree-aware CLI sort.
  Lodash `orderBy` makes the stable sort rules explicit.
- `src/panel.ts`: raw-mode keyboard input, the draft UI, rendering, and confirmation.
- `src/utils.ts`: small shared helpers, such as the record type guard.
- `scripts/run.sh`: finds Node when Herdr's PATH is limited, then runs the compiled CLI.
- `herdr-plugin.toml`: plugin identity, pnpm build steps, actions, and the popup declaration.
- `test/`: pure ordering and config tests, plus tests against a real local Unix socket.

## Behavior that must stay true

- Moving in the panel only edits a draft. The workspace order changes only when you press Enter.
- Saving priorities changes the config, not the workspace order.
- Cancel never applies a draft. Priorities you saved earlier stay saved.
- The default priorities are lowercase: fix, feat, docs, style, refactor, test, build, chore,
  revert, hotfix.
- Prefix matching ignores case and matches either the whole label or `prefix:`.
- A root repository workspace moves together with its linked worktree children, as long as they sit
  next to it. Children move among their siblings.
- Cyan `moved` means you moved it directly. Yellow `shifted` means it moved because something else
  moved. Green `current` means it is the focused workspace.
- The suggested order keeps repository roots in place and sorts their children. A standalone
  workspace with no group stays in place in the tree-aware suggestion.
- The CLI `sort` keeps the old flat-list sorting when there is no worktree metadata.
- The UI text and the docs are in English.

## Socket facts confirmed with Herdr 0.9.3

The socket path comes from `HERDR_SOCKET_PATH`, and falls back to `~/.config/herdr/herdr.sock`.
Each JSON request has a string `id`, a `method`, `params`, and a newline. Check incoming data with
Zod before you use it. Keep UTF-8 intact across socket chunks, and close the connection on success
and on failure.

`workspace.move` uses an insertion index taken before the workspace is removed. To move a workspace
down by one, pass the current index plus 2. `workspace.move_block` takes `workspace_ids` and
`before_workspace_id`; null means "append". Never send an empty block, and never use an anchor that
is inside the moved block.

When you apply the panel, it sends the whole draft as one `move_block` request. There is no check
for changes made by other clients, so do not call it transactionally safe.

## Config and UI limits

Config path: `$HERDR_PLUGIN_CONFIG_DIR/config.json`, which defaults to
`~/.config/herdr/plugins/config/herdr-workspace-organizer/config.json`. Only a missing file uses the
defaults. If the config is invalid, show the error; never overwrite the user's settings silently.
Save by writing a temporary file and then renaming it.

The popup manifest accepts fixed rows or percentages, not automatic height. The current size is 86
columns and 72% height. There is no scrolling yet, so long lists and small terminals need more work.
Do not claim these are handled.

The default open binding is `prefix+shift+m`. `prefix+w` belongs to Herdr's workspace picker, so do
not override it. Do not change the user's Herdr config, focus, live order, or installed plugin just
to run tests. Ask before any live change, and put the order back after an approved live test.

## Coding rules

- Always use braces around every if/else body. Oxlint enforces this.
- Use strict TypeScript: `unknown` at external boundaries, no `any`, no non-null assertions, and no
  unchecked casts.
- Prefer small pure functions and tests over a framework rewrite.
- Use Zod for external schemas, Commander for CLI parsing, Chalk for styling, and
  string-width/slice-ansi for terminal text.
- Raw ANSI stays for terminal controls and some legacy styling. Do not add more custom color
  parsing.
- Use lodash-es only when it makes the code simpler. Native map/filter is fine.
- Effect 3 is stable on purpose; do not upgrade to Effect 4 without checking the APIs. Keep the
  public client Promise-based unless a broader migration is approved.
- Never retry workspace changes automatically. A request can succeed even if the connection drops
  right after.

## Known follow-ups

Before applying an old draft, detect conflicts first. Then handle scrolling and resizing, clean up
the terminal on signals, split UI state, rendering, and input, and add tests for all of it. Tree
grouping assumes children sit next to their parent and that the root is visible. Check unclear
topology and report it instead of regrouping it silently.
