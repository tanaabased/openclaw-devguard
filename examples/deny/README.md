# Deny Example

This scenario sends deterministic tool attempts through OpenClaw's live before-tool-call policy chain and verifies terminal denial.

## Setup

```bash
# should prepare and initialize the policy probe fixture
test -f "$DEVGUARD_PACKAGE"
cp -R "$GITHUB_WORKSPACE/examples/fixtures/plugin" "$TMPDIR/plugin"
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard
openclaw devguard init "$TMPDIR/plugin"
find "$DEVGUARD_HOME/projects" -path '*/state/openclaw.json' -print -quit > "$TMPDIR/config-path"
dirname "$(cat "$TMPDIR/config-path")" > "$TMPDIR/state-path"

# should start a verified supervised gateway
(cd "$TMPDIR/plugin" && exec openclaw devguard run > "$TMPDIR/run.log" 2>&1) &
echo "$!" > "$TMPDIR/run.pid"
node "$GITHUB_WORKSPACE/examples/support/check.mjs" wait-text "$TMPDIR/run.log" "ready        devguard-example" 1 60
```

## Testing

```bash
# should block exec through the live openclaw policy chain
OPENCLAW_STATE_DIR="$(cat "$TMPDIR/state-path")" openclaw gateway call devguard-example.attempt-tool --json --params '{"toolName":"exec"}' > "$TMPDIR/exec-result.json"
node "$GITHUB_WORKSPACE/examples/support/check.mjs" assert-blocked "$TMPDIR/exec-result.json"
test ! -e "$TMPDIR/exec-sentinel"

# should block filesystem mutation through the live openclaw policy chain
OPENCLAW_STATE_DIR="$(cat "$TMPDIR/state-path")" openclaw gateway call devguard-example.attempt-tool --json --params '{"toolName":"write"}' > "$TMPDIR/write-result.json"
node "$GITHUB_WORKSPACE/examples/support/check.mjs" assert-blocked "$TMPDIR/write-result.json"
test ! -e "$TMPDIR/write-sentinel"

# should deny unknown tools and record redacted correlated decisions
OPENCLAW_STATE_DIR="$(cat "$TMPDIR/state-path")" openclaw gateway call devguard-example.attempt-tool --json --params '{"toolName":"totally-unknown-tool"}' > "$TMPDIR/unknown-result.json"
node "$GITHUB_WORKSPACE/examples/support/check.mjs" assert-blocked "$TMPDIR/unknown-result.json"
test ! -e "$TMPDIR/totally-unknown-tool-sentinel"
find "$DEVGUARD_HOME/projects" -path '*/logs/events.jsonl' -print -quit > "$TMPDIR/log-path"
node "$GITHUB_WORKSPACE/examples/support/check.mjs" assert-deny-log "$(cat "$TMPDIR/log-path")"

# should stop supervision cleanly
kill -TERM "$(cat "$TMPDIR/run.pid")"
node "$GITHUB_WORKSPACE/examples/support/check.mjs" wait-exit "$(cat "$TMPDIR/run.pid")" 20
```
