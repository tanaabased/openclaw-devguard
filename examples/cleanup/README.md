# Cleanup Example

This scenario verifies that initialization bounds a hung build, live supervision bounds a hung replacement validation, and DevGuard removes each owned process tree without sacrificing the last working Gateway.

## Setup

```bash
# should install and enable packed devguard
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard

# should time out initialization and remove the hung build process tree
cp "$GITHUB_WORKSPACE/examples/cleanup/build-timeout.devguard.json" "$GITHUB_WORKSPACE/devguard.json"
if openclaw devguard init "$GITHUB_WORKSPACE" --no-model-profile > "$TMPDIR/init-timeout.log" 2>&1; then exit 1; fi
grep -F "build timed out after 1 second" "$TMPDIR/init-timeout.log" | grep -F "cleanup killed"
"$GITHUB_WORKSPACE/examples/cleanup/assert-process-tree-stopped.sh" build

# should initialize with bounded replacement validation
cp "$GITHUB_WORKSPACE/examples/cleanup/validation-timeout.devguard.json" "$GITHUB_WORKSPACE/devguard.json"
openclaw devguard init "$GITHUB_WORKSPACE" --no-model-profile
find "$DEVGUARD_HOME/projects" -name init.json -print -quit > "$TMPDIR/marker-path"
dirname "$(cat "$TMPDIR/marker-path")" > "$TMPDIR/project-path"
printf '%s/logs/events.jsonl\n' "$(cat "$TMPDIR/project-path")" > "$TMPDIR/log-path"

# should start the first verified gateway
(cd "$GITHUB_WORKSPACE" && exec openclaw devguard run > "$TMPDIR/run.log" 2>&1) &
echo "$!" > "$TMPDIR/run.pid"
"$GITHUB_WORKSPACE/scripts/wait-for-plugin-load.sh"
```

## Testing

```bash
# should time out a replacement validation and remove its process tree
touch "$TMPDIR/hang-validation"
printf '\n// leia cleanup rebuild\n' >> "$GITHUB_WORKSPACE/index.ts"
"$GITHUB_WORKSPACE/examples/cleanup/wait-for-validation-timeout.sh"
"$GITHUB_WORKSPACE/examples/cleanup/assert-process-tree-stopped.sh" validation

# should retain the last working gateway after the failed replacement
kill -0 "$(cat "$TMPDIR/run.pid")"
(cd "$GITHUB_WORKSPACE" && openclaw devguard doctor)
log_path="$(cat "$TMPDIR/log-path")"
grep -F '"event":"plugin_validation_failed"' "$log_path" \
  | grep -F '"timedOut":true' \
  | grep -F '"cleanupOutcome":"killed"'
```

## Cleanup

```bash
# should stop supervision and its gateway cleanly
"$GITHUB_WORKSPACE/scripts/stop-supervision.sh"
```
