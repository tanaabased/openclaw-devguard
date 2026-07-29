# Restart Example

This scenario edits DevGuard while it supervises itself and verifies a controlled Gateway replacement with a distinct live build.

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

# should start the first verified plugin build
(cd "$GITHUB_WORKSPACE" && exec openclaw --profile "$OPENCLAW_SOURCE_PROFILE" devguard run > "$TMPDIR/run.log" 2>&1) &
echo "$!" > "$TMPDIR/run.pid"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" wait-text "$(cat "$TMPDIR/log-path")" '"event":"target_plugin_loaded"' 1 60 "$(cat "$TMPDIR/run.pid")"
```

## Testing

```bash
# should rebuild and verify a replacement gateway after a watched edit
printf '\n// leia rebuild\n' >> "$GITHUB_WORKSPACE/index.ts"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" wait-text "$(cat "$TMPDIR/log-path")" '"event":"target_plugin_loaded"' 2 60 "$(cat "$TMPDIR/run.pid")"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" assert-restart-log "$(cat "$TMPDIR/log-path")"

# should stop supervision cleanly
kill -TERM "$(cat "$TMPDIR/run.pid")"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" wait-exit "$(cat "$TMPDIR/run.pid")" 20
```
