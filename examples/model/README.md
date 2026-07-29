# Model Example

This scenario verifies that initialization imports an OpenAI-onboarded source profile's default model and portable authentication into isolated DevGuard state, then uses that copied authentication for a live turn.

## Setup

```bash
# should onboard the source profile with OpenAI and prepare a fixture plugin
test -f "$DEVGUARD_PACKAGE"
test -n "$OPENAI_API_KEY"
test -n "$OPENAI_MODEL"
cp -R "$GITHUB_WORKSPACE/examples/fixtures/plugin" "$TMPDIR/plugin"
openclaw onboard --non-interactive --accept-risk \
  --mode local \
  --auth-choice openai-api-key \
  --openai-api-key "$OPENAI_API_KEY" \
  --secret-input-mode plaintext \
  --workspace "$TMPDIR/source-main" \
  --gateway-bind loopback \
  --skip-daemon \
  --skip-health \
  --skip-bootstrap \
  --skip-channels \
  --skip-hooks \
  --skip-search \
  --skip-skills \
  --skip-ui \
  --suppress-gateway-token-output > "$TMPDIR/onboard.log" 2>&1
openclaw models set "openai/$OPENAI_MODEL" >> "$TMPDIR/onboard.log" 2>&1

# should install and enable packed devguard in the source profile
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard
cp "$OPENCLAW_STATE_DIR/openclaw.json" "$TMPDIR/source-before.json"

# should initialize the fixture with the source model profile
unset OPENAI_API_KEY
openclaw devguard init "$TMPDIR/plugin" > "$TMPDIR/init.log" 2>&1
find "$DEVGUARD_HOME/projects" -path '*/state/openclaw.json' -print -quit > "$TMPDIR/config-path"
dirname "$(cat "$TMPDIR/config-path")" > "$TMPDIR/state-path"

# should complete a live gateway turn with imported authentication
unset OPENAI_API_KEY
export OPENCLAW_GATEWAY_STARTUP_TRACE=1
(cd "$TMPDIR/plugin" && exec openclaw devguard run --startup-timeout 60 > "$TMPDIR/run.log" 2>&1) &
echo "$!" > "$TMPDIR/run.pid"
node "$GITHUB_WORKSPACE/examples/support/check.mjs" wait-text "$TMPDIR/run.log" "ready        devguard-example" 1 90 "$(cat "$TMPDIR/run.pid")"
OPENCLAW_STATE_DIR="$(cat "$TMPDIR/state-path")" openclaw agent --session-key devguard-model-live --message "Reply exactly: DEVGUARD_MODEL_OK" --json > "$TMPDIR/live-response.json"
```

## Testing

```bash
# should import the model and portable authentication without changing the source config
cmp "$TMPDIR/source-before.json" "$OPENCLAW_STATE_DIR/openclaw.json"
node "$GITHUB_WORKSPACE/examples/support/profile.mjs" assert-model "$(cat "$TMPDIR/state-path")" "$OPENCLAW_STATE_DIR"

# should report the imported model without exposing credential material
grep -F "agents       main" "$TMPDIR/init.log"
grep -F "model        openai/$OPENAI_MODEL" "$TMPDIR/init.log"
grep -F "auth         1 copied" "$TMPDIR/init.log"
if grep -Fq "$OPENAI_API_KEY" "$TMPDIR/init.log"; then exit 1; fi

# should return the live model response
grep -F "DEVGUARD_MODEL_OK" "$TMPDIR/live-response.json"
```

## Cleanup

```bash
# should stop live supervision
if kill -0 "$(cat "$TMPDIR/run.pid")" 2>/dev/null; then
  kill -TERM "$(cat "$TMPDIR/run.pid")"
  node "$GITHUB_WORKSPACE/examples/support/check.mjs" wait-exit "$(cat "$TMPDIR/run.pid")" 20
fi
```
