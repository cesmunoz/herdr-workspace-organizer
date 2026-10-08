#!/bin/sh
set -eu

find_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi

  for candidate in \
    "$HOME/.local/share/mise/shims/node" \
    "$HOME/.local/bin/node" \
    "$HOME/.nvm/current/bin/node" \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    /usr/bin/node
  do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return
    fi
  done

  return 1
}

NODE_BIN="$(find_node)" || {
  echo "herdr-workspace-organizer: Node.js was not found; install Node.js 20+ in PATH" >&2
  exit 127
}

exec "$NODE_BIN" "$HERDR_PLUGIN_ROOT/dist/src/cli.js" "$@"
