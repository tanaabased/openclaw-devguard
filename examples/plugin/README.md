# Plugin Example

This scenario uses packed DevGuard to supervise a separate linked plugin. A live Data agent requests an exec, the target plugin contributes `DEVGUARD_EXAMPLE_EXEC_ENV=positronic` through `resolve_exec_env`, and DevGuard proves that exact value reached its recorder without running the requested command. Deterministic calls continue to verify unsupported and unknown tool denial.

## Setup

```bash
# should onboard the source profile with openai
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

# should register the scenario-owned data workspace and identity
cp -R "$GITHUB_WORKSPACE/examples/plugin/data" "$TMPDIR/source-data"
openclaw agents add data --workspace "$TMPDIR/source-data" --non-interactive
openclaw agents set-identity --agent data --workspace "$TMPDIR/source-data" --from-identity

# should prepare the scenario-owned target plugin
mkdir -p "$TMPDIR/plugin"
cp "$GITHUB_WORKSPACE/examples/plugin/index.mjs" "$GITHUB_WORKSPACE/examples/plugin/openclaw.plugin.json" "$GITHUB_WORKSPACE/examples/plugin/package.json" "$TMPDIR/plugin"

# should install and enable packed devguard
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard

# should create and then reuse the target project configuration
unset OPENAI_API_KEY
set -o pipefail
openclaw devguard init "$TMPDIR/plugin" --agent data 2>&1 | grep -F "config" | grep -F "created"
cp "$GITHUB_WORKSPACE/examples/plugin/devguard.json" "$TMPDIR/plugin/devguard.json"
openclaw devguard init "$TMPDIR/plugin" --agent data 2>&1 | grep -F "config" | grep -F "reused"
find "$DEVGUARD_HOME/projects" -name init.json -print -quit > "$TMPDIR/marker-path"
dirname "$(cat "$TMPDIR/marker-path")" > "$TMPDIR/project-path"
printf '%s/logs/events.jsonl\n' "$(cat "$TMPDIR/project-path")" > "$TMPDIR/log-path"

# should start a verified supervised gateway
unset OPENAI_API_KEY
(cd "$TMPDIR/plugin" && exec openclaw devguard run > "$TMPDIR/run.log" 2>&1) &
echo "$!" > "$TMPDIR/run.pid"
"$GITHUB_WORKSPACE/scripts/wait-for-plugin-load.sh" 1 90
```

## Testing

```bash
# should infer, build, and expose the separate target plugin
grep -F '"id"' "$TMPDIR/plugin/devguard.json" | grep -F '"devguard-example"'
grep -F '"mode"' "$TMPDIR/plugin/devguard.json" | grep -F '"probe"'
grep -F '"DEVGUARD_EXAMPLE_EXEC_ENV"' "$TMPDIR/plugin/devguard.json"
(cd "$TMPDIR/plugin" && openclaw devguard doctor)

# should run the live data agent through resolve_exec_env and the exec probe
requested_command="touch \"$TMPDIR/model-exec-sentinel\""
(cd "$TMPDIR/plugin" && openclaw devguard exec -- agent --agent data --session-key devguard-plugin-probe --message "Run the exec tool exactly once with this exact command, then report the tool result without retrying: $requested_command" --json)
"$GITHUB_WORKSPACE/examples/plugin/wait-for-exec-probe.sh"
test ! -e "$TMPDIR/model-exec-sentinel"

# should block filesystem mutation through the live openclaw policy chain
set -o pipefail
(cd "$TMPDIR/plugin" && openclaw devguard exec -- gateway call devguard-example.attempt-tool --json --params '{"toolName":"write"}') | grep -F '"blocked"' | grep -F "true"
test ! -e "$TMPDIR/write-sentinel"

# should deny unknown tools through the live openclaw policy chain
set -o pipefail
(cd "$TMPDIR/plugin" && openclaw devguard exec -- gateway call devguard-example.attempt-tool --json --params '{"toolName":"totally-unknown-tool"}') | grep -F '"blocked"' | grep -F "true"
test ! -e "$TMPDIR/totally-unknown-tool-sentinel"

# should prove resolve_exec_env added devguard_example_exec_env=positronic to the probe process
log_path="$(cat "$TMPDIR/log-path")"
positronic_sha256="$(printf '%s' "positronic" | shasum -a 256 | awk '{print $1}')"
grep -F '"event":"tool_call_probe_completed"' "$log_path" \
  | grep -F '"originalCommandExecuted":false' \
  | grep -F '"name":"DEVGUARD_EXAMPLE_EXEC_ENV"' \
  | grep -F "\"sha256\":\"$positronic_sha256\""

# should record blocked decisions without exposing sensitive values
log_path="$(cat "$TMPDIR/log-path")"
grep -F '"event":"tool_call_blocked"' "$log_path" | grep -F '"toolName":"write"'
grep -F '"event":"tool_call_blocked"' "$log_path" | grep -F '"toolName":"totally-unknown-tool"'
if grep -Fq "leia-sensitive-value" "$log_path"; then exit 1; fi
if grep -Fq "positronic" "$log_path"; then exit 1; fi
```

## Cleanup

```bash
# should stop supervision cleanly
"$GITHUB_WORKSPACE/scripts/stop-supervision.sh"
```
