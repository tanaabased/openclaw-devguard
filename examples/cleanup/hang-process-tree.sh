#!/usr/bin/env bash

set -euo pipefail

phase="${1:?phase is required}"
trap '' TERM
echo "$$" > "$TMPDIR/$phase-parent.pid"

(
  trap '' TERM
  while true; do sleep 1; done
) &
echo "$!" > "$TMPDIR/$phase-child.pid"

wait
