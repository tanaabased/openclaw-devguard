# Model Example

This scenario verifies that initialization imports the source profile's default model and portable authentication into isolated DevGuard state.

## Setup

```bash
# should prepare a source model profile and fixture plugin
test -f "$DEVGUARD_PACKAGE"
cp -R "$GITHUB_WORKSPACE/examples/fixtures/plugin" "$TMPDIR/plugin"
node "$GITHUB_WORKSPACE/examples/support/profile.mjs" seed-model

# should install and enable packed devguard in the source profile
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard
cp "$OPENCLAW_STATE_DIR/openclaw.json" "$TMPDIR/source-before.json"

# should initialize the fixture with the source model profile
unset OPENAI_API_KEY
openclaw devguard init "$TMPDIR/plugin" > "$TMPDIR/init.log" 2>&1
find "$DEVGUARD_HOME/projects" -path '*/state/openclaw.json' -print -quit > "$TMPDIR/config-path"
dirname "$(cat "$TMPDIR/config-path")" > "$TMPDIR/state-path"

# should complete an optional live gateway turn with imported authentication
if [ -z "$DEVGUARD_LIVE_MODEL" ]; then exit 0; fi
unset OPENAI_API_KEY
(cd "$TMPDIR/plugin" && exec openclaw devguard run > "$TMPDIR/run.log" 2>&1) &
echo "$!" > "$TMPDIR/run.pid"
node "$GITHUB_WORKSPACE/examples/support/check.mjs" wait-text "$TMPDIR/run.log" "ready        devguard-example" 1 90
OPENCLAW_STATE_DIR="$(cat "$TMPDIR/state-path")" openclaw agent --session-key devguard-model-live --message "Reply exactly: DEVGUARD_MODEL_OK" --json > "$TMPDIR/live-response.json"
```

## Testing

```bash
# should import the model and portable authentication without changing the source config
cmp "$TMPDIR/source-before.json" "$OPENCLAW_STATE_DIR/openclaw.json"
node "$GITHUB_WORKSPACE/examples/support/profile.mjs" assert-model "$(cat "$TMPDIR/state-path")" "$OPENCLAW_STATE_DIR"

# should report the imported model without exposing credential material
grep -F "agents       main" "$TMPDIR/init.log"
if [ -n "$DEVGUARD_LIVE_MODEL" ]; then grep -F "model        $DEVGUARD_LIVE_MODEL" "$TMPDIR/init.log"; else grep -F "model        openai/gpt-5.6-sol" "$TMPDIR/init.log"; fi
grep -F "auth         1 copied" "$TMPDIR/init.log"
if grep -F "leia-model-key" "$TMPDIR/init.log"; then exit 1; fi

# should return the optional live model response
if [ -z "$DEVGUARD_LIVE_MODEL" ]; then exit 0; fi
grep -F "DEVGUARD_MODEL_OK" "$TMPDIR/live-response.json"
```

## Cleanup

```bash
# should stop optional live supervision
if [ ! -f "$TMPDIR/run.pid" ]; then exit 0; fi
kill -TERM "$(cat "$TMPDIR/run.pid")"
node "$GITHUB_WORKSPACE/examples/support/check.mjs" wait-exit "$(cat "$TMPDIR/run.pid")" 20
```
