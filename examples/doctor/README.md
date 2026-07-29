# Doctor Example

This scenario keeps DevGuard's self-targeted Gateway live while it aggregates safety and OpenClaw diagnostics.

## Setup

```bash
# should prepare and initialize devguard as its own target
test -f "$DEVGUARD_PACKAGE"
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" plugins install "$DEVGUARD_PACKAGE" --force
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" plugins enable openclaw-devguard
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" devguard init "$GITHUB_WORKSPACE"
find "$DEVGUARD_HOME/projects" -name init.json -print -quit > "$TMPDIR/marker-path"
dirname "$(cat "$TMPDIR/marker-path")" > "$TMPDIR/project-path"
printf '%s/logs/events.jsonl\n' "$(cat "$TMPDIR/project-path")" > "$TMPDIR/log-path"

# should start a verified supervised gateway
(cd "$GITHUB_WORKSPACE" && exec openclaw --profile "$OPENCLAW_SOURCE_PROFILE" devguard run > "$TMPDIR/run.log" 2>&1) &
echo "$!" > "$TMPDIR/run.pid"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" wait-text "$(cat "$TMPDIR/log-path")" '"event":"target_plugin_loaded"' 1 60 "$(cat "$TMPDIR/run.pid")"
```

## Testing

```bash
# should pass the aggregate safety and runtime doctor
set -o pipefail
(cd "$GITHUB_WORKSPACE" && openclaw --profile "$OPENCLAW_SOURCE_PROFILE" devguard doctor) 2>&1 | tee "$TMPDIR/doctor.log"
grep -F "pass" "$TMPDIR/doctor.log" | grep -F "native profile selected"
grep -F "pass" "$TMPDIR/doctor.log" | grep -F "isolated profile active"
grep -F "pass" "$TMPDIR/doctor.log" | grep -F "unknown tools denied"
grep -F "pass" "$TMPDIR/doctor.log" | grep -F "current plugin build"

# should stop supervision cleanly
kill -TERM "$(cat "$TMPDIR/run.pid")"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" wait-exit "$(cat "$TMPDIR/run.pid")" 20
```
