#!/bin/sh
# Runs a script with the Node runtime bundled in the Codex app, so no separate
# Node install is needed. Usage: run-node.sh <script.mjs> [args...]
set -eu

find_codex_app() {
  if [ -n "${CODEX_APP_PATH:-}" ]; then
    printf '%s\n' "$CODEX_APP_PATH"
    return
  fi
  found=$(mdfind "kMDItemCFBundleIdentifier == 'com.openai.codex'" 2>/dev/null | while IFS= read -r candidate; do
    if [ -x "$candidate/Contents/Resources/cua_node/bin/node" ]; then
      printf '%s\n' "$candidate"
      break
    fi
  done)
  if [ -n "$found" ]; then
    printf '%s\n' "$found"
    return
  fi
  for candidate in /Applications/ChatGPT.app /Applications/Codex.app "$HOME/Applications/ChatGPT.app" "$HOME/Applications/Codex.app"; do
    if [ -x "$candidate/Contents/Resources/cua_node/bin/node" ]; then
      printf '%s\n' "$candidate"
      return
    fi
  done
}

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This setup supports macOS only." >&2
  exit 1
fi

# Honor --codex-app so the same app is used to run the script.
prev=""
for arg in "$@"; do
  case "$arg" in
    --codex-app=*) CODEX_APP_PATH="${arg#--codex-app=}" ;;
  esac
  if [ "$prev" = "--codex-app" ]; then CODEX_APP_PATH="$arg"; fi
  prev="$arg"
done

app=$(find_codex_app || true)
node="$app/Contents/Resources/cua_node/bin/node"
if [ -z "$app" ] || [ ! -x "$node" ]; then
  echo "Could not find the Codex desktop app with Computer Use support." >&2
  echo "Install the Codex desktop app, or pass --codex-app /path/to/App.app." >&2
  exit 1
fi

exec "$node" "$@"
