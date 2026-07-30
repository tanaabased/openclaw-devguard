#!/usr/bin/env bash

set -euo pipefail

port="${1:?port is required}"
ready_path="$TMPDIR/port-owner.ready"
log_path="$TMPDIR/port-owner.log"
rm -f "$ready_path"

node -e 'const fs = require("node:fs"); const net = require("node:net"); const server = net.createServer(); server.listen(Number(process.argv[1]), "127.0.0.1", () => fs.writeFileSync(process.argv[2], "ready\n"));' "$port" "$ready_path" > "$log_path" 2>&1 &
owner_pid="$!"
echo "$owner_pid" > "$TMPDIR/port-owner.pid"

deadline=$((SECONDS + 10))
until test -f "$ready_path"; do
  if ! kill -0 "$owner_pid" 2>/dev/null || ((SECONDS >= deadline)); then
    cat "$log_path" >&2
    exit 1
  fi
  sleep 1
done
