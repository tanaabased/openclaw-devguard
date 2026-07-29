# Model Example

This scenario dogfoods DevGuard's self-target path while verifying that initialization imports an OpenAI-onboarded source profile's default model and portable authentication, then uses that copied authentication for a live turn.

## Setup

```bash
# should onboard the source profile with OpenAI and prepare devguard as the target
test -f "$DEVGUARD_PACKAGE"
test -n "$OPENAI_API_KEY"
test -n "$OPENAI_MODEL"
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
  --suppress-gateway-token-output
openclaw models set "openai/$OPENAI_MODEL"

# should install and enable packed devguard in the source profile
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard
openclaw config file | sed "s|^~|$HOME|" > "$TMPDIR/source-config-path"
cp "$(cat "$TMPDIR/source-config-path")" "$TMPDIR/source-before.json"

# should initialize devguard with the source model profile
unset OPENAI_API_KEY
openclaw devguard init "$GITHUB_WORKSPACE" > "$TMPDIR/init.log" 2>&1
openclaw devguard profile "$GITHUB_WORKSPACE" > "$TMPDIR/devguard-profile"
find "$DEVGUARD_HOME/projects" -name init.json -print -quit > "$TMPDIR/marker-path"
dirname "$(cat "$TMPDIR/marker-path")" > "$TMPDIR/project-path"
printf '%s/logs/events.jsonl\n' "$(cat "$TMPDIR/project-path")" > "$TMPDIR/log-path"

# should start a live gateway with imported authentication
unset OPENAI_API_KEY
(cd "$GITHUB_WORKSPACE" && exec openclaw devguard run > "$TMPDIR/run.log" 2>&1) &
echo "$!" > "$TMPDIR/run.pid"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" wait-text "$(cat "$TMPDIR/log-path")" '"event":"target_plugin_loaded"' 1 90 "$(cat "$TMPDIR/run.pid")"
```

## Testing

```bash
# should import the model and portable authentication without changing the source config
cmp "$TMPDIR/source-before.json" "$(cat "$TMPDIR/source-config-path")"

# should report the imported model without exposing credential material
set -o pipefail
grep -F "agents" "$TMPDIR/init.log" | grep -F "main"
grep -F "model" "$TMPDIR/init.log" | grep -F "openai/$OPENAI_MODEL"
grep -F "auth" "$TMPDIR/init.log" | grep -F "1 copied"
if grep -Fq "$OPENAI_API_KEY" "$TMPDIR/init.log"; then exit 1; fi

# should return the live model response
set -o pipefail
unset OPENAI_API_KEY
openclaw --profile "$(cat "$TMPDIR/devguard-profile")" agent --session-key devguard-model-live --message "Reply exactly: DEVGUARD_MODEL_OK" --json | grep -F "DEVGUARD_MODEL_OK"
```

## Cleanup

```bash
# should stop live supervision
if kill -0 "$(cat "$TMPDIR/run.pid")" 2>/dev/null; then
  kill -TERM "$(cat "$TMPDIR/run.pid")"
  node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" wait-exit "$(cat "$TMPDIR/run.pid")" 20
fi
```
