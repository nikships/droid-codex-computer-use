#!/bin/sh
# Install from a checkout:   ./install.sh [options]
# Install straight from GitHub:
#   curl -fsSL https://raw.githubusercontent.com/nikships/droid-codex-computer-use/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/nikships/droid-codex-computer-use/main/install.sh | sh -s -- [options]
set -eu

REPO="nikships/droid-codex-computer-use"
ENTRY="scripts/install.mjs"

# Everything runs inside main, which is called on the last line. When the script
# is piped into sh, this makes sh read the whole file before any command runs.
main() {
  if [ -f "$0" ] && [ -f "$(dirname "$0")/$ENTRY" ]; then
    here=$(cd "$(dirname "$0")" && pwd)
    exec "$here/scripts/run-node.sh" "$here/$ENTRY" "$@" </dev/null
  fi

  ref=${CODEX_CU_REF:-main}
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/codex-computer-use.XXXXXX")
  trap 'rm -rf "$tmp"' EXIT
  trap 'exit 130' INT TERM

  echo "Downloading $REPO ($ref)..."
  curl -fsSL "https://github.com/$REPO/archive/$ref.tar.gz" | tar -xzf - -C "$tmp" --strip-components=1
  "$tmp/scripts/run-node.sh" "$tmp/$ENTRY" "$@" </dev/null
}

main "$@"
