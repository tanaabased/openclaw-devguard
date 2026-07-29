# Restart Example

This scenario edits a watched plugin source and verifies a controlled Gateway replacement with a distinct live build.

## Setup

```bash
# should prepare and initialize the fixture plugin
test -f "$DEVGUARD_PACKAGE"
cp -R "$GITHUB_WORKSPACE/fixtures/devguard-example-plugin" "$TMPDIR/plugin"
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard
openclaw devguard init "$TMPDIR/plugin"

# should start the first verified plugin build
(cd "$TMPDIR/plugin" && exec openclaw devguard run > "$TMPDIR/run.log" 2>&1) &
echo "$!" > "$TMPDIR/run.pid"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" wait-text "$TMPDIR/run.log" "ready        devguard-example" 1 60
```

## Testing

```bash
# should rebuild and verify a replacement gateway after a watched edit
printf '\n// leia rebuild\n' >> "$TMPDIR/plugin/index.ts"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" wait-text "$TMPDIR/run.log" "ready        devguard-example" 2 60
find "$DEVGUARD_HOME/projects" -path '*/logs/events.jsonl' -print -quit > "$TMPDIR/log-path"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" assert-restart-log "$(cat "$TMPDIR/log-path")"

# should stop supervision cleanly
kill -TERM "$(cat "$TMPDIR/run.pid")"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" wait-exit "$(cat "$TMPDIR/run.pid")" 20
```
