#!/usr/bin/env bash

set -euo pipefail

if test -f "$TMPDIR/hang-validation"; then
  exec "$GITHUB_WORKSPACE/examples/cleanup/hang-process-tree.sh" validation
fi

exec bun run plugin:check
