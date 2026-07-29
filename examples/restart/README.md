# Restart Example

This scenario edits DevGuard while it supervises itself and verifies a controlled Gateway replacement with a distinct live build.

## Setup

```bash
# should prepare and initialize devguard as its own target
test -f "$DEVGUARD_PACKAGE"
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard
openclaw devguard init "$GITHUB_WORKSPACE"
find "$DEVGUARD_HOME/projects" -name init.json -print -quit > "$TMPDIR/marker-path"
dirname "$(cat "$TMPDIR/marker-path")" > "$TMPDIR/project-path"
printf '%s/logs/events.jsonl\n' "$(cat "$TMPDIR/project-path")" > "$TMPDIR/log-path"

# should start the first verified plugin build
(cd "$GITHUB_WORKSPACE" && exec openclaw devguard run > "$TMPDIR/run.log" 2>&1) &
echo "$!" > "$TMPDIR/run.pid"
log_path="$(cat "$TMPDIR/log-path")"
run_pid="$(cat "$TMPDIR/run.pid")"
deadline=$((SECONDS + 60))
until grep -Fq '"event":"target_plugin_loaded"' "$log_path" 2>/dev/null; do
  if ! kill -0 "$run_pid" 2>/dev/null; then
    tail -n 120 "$TMPDIR/run.log"
    exit 1
  fi
  if ((SECONDS >= deadline)); then
    tail -n 120 "$TMPDIR/run.log"
    exit 1
  fi
  sleep 1
done
```

## Testing

```bash
# should rebuild and verify a replacement gateway after a watched edit
printf '\n// leia rebuild\n' >> "$GITHUB_WORKSPACE/index.ts"
log_path="$(cat "$TMPDIR/log-path")"
run_pid="$(cat "$TMPDIR/run.pid")"
deadline=$((SECONDS + 60))
loaded_count="$(grep -Fc '"event":"target_plugin_loaded"' "$log_path" 2>/dev/null || true)"
while ((loaded_count < 2)); do
  if ! kill -0 "$run_pid" 2>/dev/null; then
    tail -n 120 "$TMPDIR/run.log"
    exit 1
  fi
  if ((SECONDS >= deadline)); then
    tail -n 120 "$TMPDIR/run.log"
    exit 1
  fi
  sleep 1
  loaded_count="$(grep -Fc '"event":"target_plugin_loaded"' "$log_path" 2>/dev/null || true)"
done

# should record two distinct successful builds and one controlled restart
test "$(grep -Fc '"event":"target_plugin_loaded"' "$log_path")" -ge 2
test "$(grep -Fc '"event":"gateway_restart_requested"' "$log_path")" -ge 1
build_count="$(grep -F '"event":"build_succeeded"' "$log_path" | sed -E 's/.*"pluginBuildId":"([^"]+)".*/\1/' | sort -u | wc -l | tr -d ' ')"
test "$build_count" -ge 2
if grep -Eq '"event":"(build_failed|gateway_exited|gateway_start_failed|target_plugin_load_failed)"' "$log_path"; then exit 1; fi

# should stop supervision cleanly
kill -TERM "$run_pid"
deadline=$((SECONDS + 20))
while kill -0 "$run_pid" 2>/dev/null; do
  if ((SECONDS >= deadline)); then exit 1; fi
  sleep 1
done
```
