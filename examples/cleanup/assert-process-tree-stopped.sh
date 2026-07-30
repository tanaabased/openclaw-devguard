#!/usr/bin/env bash

set -euo pipefail

phase="${1:?phase is required}"
timeout_seconds="${2:-10}"
deadline=$((SECONDS + timeout_seconds))

process_is_active() {
  local pid="$1"
  local state
  if ! kill -0 "$pid" 2>/dev/null; then return 1; fi
  state="$(ps -o stat= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
  test -n "$state" && test "${state#Z}" = "$state"
}

parent_pid="$(cat "$TMPDIR/$phase-parent.pid")"
child_pid="$(cat "$TMPDIR/$phase-child.pid")"
while process_is_active "$parent_pid" || process_is_active "$child_pid"; do
  if ((SECONDS >= deadline)); then
    ps -o pid=,ppid=,pgid=,stat=,command= -p "$parent_pid" -p "$child_pid" >&2 || true
    exit 1
  fi
  sleep 1
done
