# Project guide

## What this project is

This repo is a Herdr plugin that organizes workspaces. The installed ID is
`herdr-workspace-organizer`. Keep that ID, the config path, the action IDs, and the user's key
bindings the same unless someone asks for a migration. The local folder may still be named
`herdr-move-panels`.

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

## Config

Config path: `$HERDR_PLUGIN_CONFIG_DIR/config.json`, which defaults to
`~/.config/herdr/plugins/config/herdr-workspace-organizer/config.json`. Only a missing file uses the
defaults. If the config is invalid, show the error; never overwrite the user's settings silently.
Save by writing a temporary file and then renaming it.

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
