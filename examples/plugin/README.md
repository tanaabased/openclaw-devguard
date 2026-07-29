# Plugin Example

This scenario uses packed DevGuard to supervise a separate linked plugin, verifies its inferred project configuration and live identity, and sends deterministic tool attempts through OpenClaw's policy chain.

## Setup

```bash
# should prepare the scenario-owned target plugin
test -f "$DEVGUARD_PACKAGE"
mkdir -p "$TMPDIR/plugin"
cp "$GITHUB_WORKSPACE/examples/plugin/index.mjs" "$GITHUB_WORKSPACE/examples/plugin/openclaw.plugin.json" "$GITHUB_WORKSPACE/examples/plugin/package.json" "$TMPDIR/plugin"

# should install and enable packed devguard
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard

# should create and then reuse the target project configuration
set -o pipefail
openclaw devguard init "$TMPDIR/plugin" 2>&1 | grep -F "config" | grep -F "created"
set -o pipefail
openclaw devguard init "$TMPDIR/plugin" 2>&1 | grep -F "config" | grep -F "reused"
find "$DEVGUARD_HOME/projects" -name init.json -print -quit > "$TMPDIR/marker-path"
dirname "$(cat "$TMPDIR/marker-path")" > "$TMPDIR/project-path"
printf '%s/logs/events.jsonl\n' "$(cat "$TMPDIR/project-path")" > "$TMPDIR/log-path"

# should start a verified supervised gateway
(cd "$TMPDIR/plugin" && exec openclaw devguard run > "$TMPDIR/run.log" 2>&1) &
echo "$!" > "$TMPDIR/run.pid"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" wait-text "$(cat "$TMPDIR/log-path")" '"event":"target_plugin_loaded"' 1 60 "$(cat "$TMPDIR/run.pid")"
```

## Testing

```bash
# should infer, build, and expose the separate target plugin
set -o pipefail
grep -F '"id"' "$TMPDIR/plugin/devguard.json" | grep -F '"devguard-example"'
test -f "$TMPDIR/plugin/index.mjs"
(cd "$TMPDIR/plugin" && openclaw devguard doctor) > "$TMPDIR/doctor.log" 2>&1
grep -F "pass" "$TMPDIR/doctor.log" | grep -F "target plugin id"
grep -F "pass" "$TMPDIR/doctor.log" | grep -F "live target plugin"

# should block exec through the live openclaw policy chain
(cd "$TMPDIR/plugin" && openclaw devguard exec -- gateway call devguard-example.attempt-tool --json --params '{"toolName":"exec"}') > "$TMPDIR/exec-result.json"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" assert-blocked "$TMPDIR/exec-result.json"
test ! -e "$TMPDIR/exec-sentinel"

# should block filesystem mutation through the live openclaw policy chain
(cd "$TMPDIR/plugin" && openclaw devguard exec -- gateway call devguard-example.attempt-tool --json --params '{"toolName":"write"}') > "$TMPDIR/write-result.json"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" assert-blocked "$TMPDIR/write-result.json"
test ! -e "$TMPDIR/write-sentinel"

# should deny unknown tools and record redacted correlated decisions
(cd "$TMPDIR/plugin" && openclaw devguard exec -- gateway call devguard-example.attempt-tool --json --params '{"toolName":"totally-unknown-tool"}') > "$TMPDIR/unknown-result.json"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" assert-blocked "$TMPDIR/unknown-result.json"
test ! -e "$TMPDIR/totally-unknown-tool-sentinel"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" assert-deny-log "$(cat "$TMPDIR/log-path")"

# should stop supervision cleanly
kill -TERM "$(cat "$TMPDIR/run.pid")"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" wait-exit "$(cat "$TMPDIR/run.pid")" 20
```
