#!/bin/sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
exec "$here/scripts/run-node.sh" "$here/scripts/verify.mjs" "$@"
