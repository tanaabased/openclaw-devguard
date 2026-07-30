#!/usr/bin/env bash

set -euo pipefail

timeout_seconds="${1:-20}"
run_pid="$(cat "$TMPDIR/run.pid")"
deadline=$((SECONDS + timeout_seconds))

if ! kill -0 "$run_pid" 2>/dev/null; then
  tail -n 120 "$TMPDIR/run.log" >&2
  exit 1
fi

kill -TERM "$run_pid"
while kill -0 "$run_pid" 2>/dev/null; do
  if ((SECONDS >= deadline)); then
    tail -n 120 "$TMPDIR/run.log" >&2
    exit 1
  fi
  sleep 1
done
