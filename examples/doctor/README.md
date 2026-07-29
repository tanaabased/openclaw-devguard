# Doctor Example

This scenario keeps DevGuard's self-targeted Gateway live while it aggregates safety and OpenClaw diagnostics.

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

# should start a verified supervised gateway
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
# should pass the aggregate safety and runtime doctor
set -o pipefail
(cd "$GITHUB_WORKSPACE" && openclaw devguard doctor) 2>&1 | tee "$TMPDIR/doctor.log"
grep -F "pass" "$TMPDIR/doctor.log" | grep -F "native profile selected"
grep -F "pass" "$TMPDIR/doctor.log" | grep -F "isolated profile active"
grep -F "pass" "$TMPDIR/doctor.log" | grep -F "unknown tools denied"
grep -F "pass" "$TMPDIR/doctor.log" | grep -F "current plugin build"

# should stop supervision cleanly
kill -TERM "$(cat "$TMPDIR/run.pid")"
run_pid="$(cat "$TMPDIR/run.pid")"
deadline=$((SECONDS + 20))
while kill -0 "$run_pid" 2>/dev/null; do
  if ((SECONDS >= deadline)); then exit 1; fi
  sleep 1
done
```
