# Doctor Example

This scenario keeps DevGuard's self-targeted Gateway live while it aggregates safety and OpenClaw diagnostics.

## Setup

```bash
# should prepare and initialize devguard as its own target
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard
openclaw devguard init "$GITHUB_WORKSPACE"
find "$DEVGUARD_HOME/projects" -name init.json -print -quit > "$TMPDIR/marker-path"
dirname "$(cat "$TMPDIR/marker-path")" > "$TMPDIR/project-path"
printf '%s/logs/events.jsonl\n' "$(cat "$TMPDIR/project-path")" > "$TMPDIR/log-path"

# should start a verified supervised gateway
(cd "$GITHUB_WORKSPACE" && exec openclaw devguard run > "$TMPDIR/run.log" 2>&1) &
echo "$!" > "$TMPDIR/run.pid"
"$GITHUB_WORKSPACE/examples/doctor/wait-for-plugin-load.sh"
```

## Testing

```bash
# should pass the aggregate safety and runtime doctor
(cd "$GITHUB_WORKSPACE" && openclaw devguard doctor)

# should stop supervision cleanly
"$GITHUB_WORKSPACE/examples/doctor/stop-supervision.sh"
```
