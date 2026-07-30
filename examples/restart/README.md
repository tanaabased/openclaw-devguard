# Restart Example

This scenario edits DevGuard while it supervises itself and verifies a controlled Gateway replacement with a distinct live build.

## Setup

```bash
# should prepare and initialize devguard as its own target
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard
openclaw devguard init "$GITHUB_WORKSPACE"
find "$DEVGUARD_HOME/projects" -name init.json -print -quit > "$TMPDIR/marker-path"
dirname "$(cat "$TMPDIR/marker-path")" > "$TMPDIR/project-path"
printf '%s/logs/events.jsonl\n' "$(cat "$TMPDIR/project-path")" > "$TMPDIR/log-path"

# should start the first verified plugin build
(cd "$GITHUB_WORKSPACE" && exec openclaw devguard run > "$TMPDIR/run.log" 2>&1) &
echo "$!" > "$TMPDIR/run.pid"
"$GITHUB_WORKSPACE/scripts/wait-for-plugin-load.sh" 1
```

## Testing

```bash
# should rebuild and verify a replacement gateway after a watched edit
printf '\n// leia rebuild\n' >> "$GITHUB_WORKSPACE/index.ts"
"$GITHUB_WORKSPACE/scripts/wait-for-plugin-load.sh" 2

# should record two distinct successful builds and one controlled restart
log_path="$(cat "$TMPDIR/log-path")"
test "$(grep -Fc '"event":"target_plugin_loaded"' "$log_path")" -ge 2
test "$(grep -Fc '"event":"gateway_restart_requested"' "$log_path")" -ge 1
build_count="$(grep -F '"event":"build_succeeded"' "$log_path" | sed -E 's/.*"pluginBuildId":"//' | cut -d '"' -f 1 | sort -u | wc -l | tr -d ' ')"
test "$build_count" -ge 2
if grep -Eq '"event":"(build_failed|gateway_exited|gateway_start_failed|target_plugin_load_failed)"' "$log_path"; then exit 1; fi

# should stop supervision cleanly
"$GITHUB_WORKSPACE/scripts/stop-supervision.sh"
```
