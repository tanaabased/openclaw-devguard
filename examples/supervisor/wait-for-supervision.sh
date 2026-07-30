#!/usr/bin/env bash

set -euo pipefail

timeout_seconds="${1:-60}"
run_pid="$(cat "$TMPDIR/run.pid")"
deadline=$((SECONDS + timeout_seconds))

until grep -Fq "ready" "$TMPDIR/run.log" 2>/dev/null; do
  if ! kill -0 "$run_pid" 2>/dev/null || ((SECONDS >= deadline)); then
    tail -n 120 "$TMPDIR/run.log" >&2
    exit 1
  fi
  sleep 1
done
