#!/usr/bin/env bash

set -euo pipefail

expected_loads="${1:-1}"
timeout_seconds="${2:-60}"
log_path="$(cat "$TMPDIR/log-path")"
run_pid="$(cat "$TMPDIR/run.pid")"
deadline=$((SECONDS + timeout_seconds))
loaded_count="$(grep -Fc '"event":"target_plugin_loaded"' "$log_path" 2>/dev/null || true)"

while ((loaded_count < expected_loads)); do
  if ! kill -0 "$run_pid" 2>/dev/null || ((SECONDS >= deadline)); then
    tail -n 120 "$TMPDIR/run.log" >&2
    exit 1
  fi
  sleep 1
  loaded_count="$(grep -Fc '"event":"target_plugin_loaded"' "$log_path" 2>/dev/null || true)"
done
