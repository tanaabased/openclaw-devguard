# Supervisor Example

This scenario verifies that one project has one DevGuard supervisor and that an unrelated process occupying the configured Gateway port is diagnosed without being stopped.

## Setup

```bash
# should install and initialize packed devguard
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard
openclaw devguard init "$GITHUB_WORKSPACE"

# should start one verified supervisor
(cd "$GITHUB_WORKSPACE" && exec openclaw devguard run > "$TMPDIR/run.log" 2>&1) &
echo "$!" > "$TMPDIR/run.pid"
"$GITHUB_WORKSPACE/examples/supervisor/wait-for-supervision.sh"
```

## Testing

```bash
# should reject a second supervisor with actionable owner context
if (cd "$GITHUB_WORKSPACE" && openclaw devguard run --once > "$TMPDIR/second-run.log" 2>&1); then exit 1; fi
grep -F "supervision is already active" "$TMPDIR/second-run.log" | grep -F "pid"

# should stop the project supervisor cleanly
"$GITHUB_WORKSPACE/scripts/stop-supervision.sh"

# should diagnose an unrelated port owner without signaling it
"$GITHUB_WORKSPACE/examples/supervisor/start-unrelated-port-owner.sh" 19001
if (cd "$GITHUB_WORKSPACE" && openclaw devguard run --once > "$TMPDIR/occupied-port.log" 2>&1); then exit 1; fi
grep -F "Gateway port 19001" "$TMPDIR/occupied-port.log" | grep -F "unavailable"
grep -F "stop its current owner or change gateway.port" "$TMPDIR/occupied-port.log"
kill -0 "$(cat "$TMPDIR/port-owner.pid")"
kill -TERM "$(cat "$TMPDIR/port-owner.pid")"
```
