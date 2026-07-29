# Tail Example

This scenario supervises DevGuard as its own target and verifies bounded human and JSON event output.

## Setup

```bash
# should prepare and initialize devguard as its own target
test -f "$DEVGUARD_PACKAGE"
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" plugins install "$DEVGUARD_PACKAGE" --force
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" plugins enable openclaw-devguard
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" devguard init "$GITHUB_WORKSPACE"

# should record one supervised lifecycle
(cd "$GITHUB_WORKSPACE" && openclaw --profile "$OPENCLAW_SOURCE_PROFILE" devguard run --once)
```

## Testing

```bash
# should emit valid bounded jsonl without decorating stdout
(cd "$GITHUB_WORKSPACE" && openclaw --profile "$OPENCLAW_SOURCE_PROFILE" devguard tail --json --no-follow) > "$TMPDIR/events.jsonl"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" assert-jsonl "$TMPDIR/events.jsonl"
grep -F '"event":"build_succeeded"' "$TMPDIR/events.jsonl"
grep -F '"event":"target_plugin_loaded"' "$TMPDIR/events.jsonl"

# should render concise lowercase human events
(cd "$GITHUB_WORKSPACE" && openclaw --profile "$OPENCLAW_SOURCE_PROFILE" devguard tail --no-follow) > "$TMPDIR/events.txt"
grep -F "build started" "$TMPDIR/events.txt"
grep -F "target plugin loaded" "$TMPDIR/events.txt"
```
