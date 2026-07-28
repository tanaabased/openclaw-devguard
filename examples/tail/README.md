# Tail Example

This scenario runs one supervised build and verifies bounded human and JSON event output.

## Setup

```bash
# should prepare and initialize the fixture plugin
test -f "$DEVGUARD_PACKAGE"
cp -R "$GITHUB_WORKSPACE/examples/fixtures/plugin" "$TMPDIR/plugin"
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard
openclaw devguard init "$TMPDIR/plugin"

# should record one supervised lifecycle
(cd "$TMPDIR/plugin" && openclaw devguard run --once)
```

## Testing

```bash
# should emit valid bounded jsonl without decorating stdout
(cd "$TMPDIR/plugin" && openclaw devguard tail --json --no-follow) > "$TMPDIR/events.jsonl"
node "$GITHUB_WORKSPACE/examples/support/check.mjs" assert-jsonl "$TMPDIR/events.jsonl"
grep -F '"event":"build_succeeded"' "$TMPDIR/events.jsonl"
grep -F '"event":"target_plugin_loaded"' "$TMPDIR/events.jsonl"

# should render concise lowercase human events
(cd "$TMPDIR/plugin" && openclaw devguard tail --no-follow) > "$TMPDIR/events.txt"
grep -F "build started" "$TMPDIR/events.txt"
grep -F "target plugin loaded" "$TMPDIR/events.txt"
```
