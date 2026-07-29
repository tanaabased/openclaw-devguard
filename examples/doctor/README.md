# Doctor Example

This scenario keeps a supervised Gateway live while DevGuard aggregates its safety and OpenClaw diagnostics.

## Setup

```bash
# should prepare and initialize the fixture plugin
test -f "$DEVGUARD_PACKAGE"
cp -R "$GITHUB_WORKSPACE/fixtures/devguard-example-plugin" "$TMPDIR/plugin"
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard
openclaw devguard init "$TMPDIR/plugin"
find "$DEVGUARD_HOME/projects" -path '*/state/openclaw.json' -print -quit > "$TMPDIR/config-path"
dirname "$(dirname "$(cat "$TMPDIR/config-path")")" > "$TMPDIR/project-path"
printf '%s/logs/events.jsonl\n' "$(cat "$TMPDIR/project-path")" > "$TMPDIR/log-path"

# should start a verified supervised gateway
(cd "$TMPDIR/plugin" && exec openclaw devguard run > "$TMPDIR/run.log" 2>&1) &
echo "$!" > "$TMPDIR/run.pid"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" wait-text "$(cat "$TMPDIR/log-path")" '"event":"target_plugin_loaded"' 1 60 "$(cat "$TMPDIR/run.pid")"
```

## Testing

```bash
# should pass the aggregate safety and runtime doctor
set -o pipefail
(cd "$TMPDIR/plugin" && openclaw devguard doctor) 2>&1 | tee "$TMPDIR/doctor.log"
grep -F "pass" "$TMPDIR/doctor.log" | grep -F "isolated profile active"
grep -F "pass" "$TMPDIR/doctor.log" | grep -F "unknown tools denied"
grep -F "pass" "$TMPDIR/doctor.log" | grep -F "current plugin build"

# should stop supervision cleanly
kill -TERM "$(cat "$TMPDIR/run.pid")"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" wait-exit "$(cat "$TMPDIR/run.pid")" 20
```
