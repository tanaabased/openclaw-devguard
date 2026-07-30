#!/usr/bin/env bash

set -euo pipefail

timeout_seconds="${1:-90}"
log_path="$(cat "$TMPDIR/log-path")"
run_pid="$(cat "$TMPDIR/run.pid")"
deadline=$((SECONDS + timeout_seconds))

until grep -Fq '"event":"target_plugin_loaded"' "$log_path" 2>/dev/null; do
  if ! kill -0 "$run_pid" 2>/dev/null || ((SECONDS >= deadline)); then
    tail -n 120 "$TMPDIR/run.log" >&2
    exit 1
  fi
  sleep 1
done
