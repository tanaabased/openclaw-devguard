# Plugin Example

This scenario uses packed DevGuard to supervise a separate linked plugin. A live Data agent requests an exec, the target plugin contributes `DEVGUARD_EXAMPLE_EXEC_ENV=positronic` through `resolve_exec_env`, and DevGuard proves that exact value reached its recorder without running the requested command. Deterministic calls continue to verify unsupported and unknown tool denial.

## Setup

```bash
# should onboard the source profile with openai
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

# should register the scenario-owned data workspace and identity
test -f "$GITHUB_WORKSPACE/examples/plugin/data/IDENTITY.md"
test -f "$GITHUB_WORKSPACE/examples/plugin/data/avatar.png"
cp -R "$GITHUB_WORKSPACE/examples/plugin/data" "$TMPDIR/source-data"
set -o pipefail
openclaw agents add data --workspace "$TMPDIR/source-data" --non-interactive --json | grep -F '"agentId"' | grep -F '"data"'
openclaw agents set-identity --agent data --workspace "$TMPDIR/source-data" --from-identity --json | grep -F '"agentId"' | grep -F '"data"'

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
set -o pipefail
openclaw devguard init "$TMPDIR/plugin" --agent data 2>&1 | grep -F "config" | grep -F "reused"
find "$DEVGUARD_HOME/projects" -name init.json -print -quit > "$TMPDIR/marker-path"
dirname "$(cat "$TMPDIR/marker-path")" > "$TMPDIR/project-path"
printf '%s/logs/events.jsonl\n' "$(cat "$TMPDIR/project-path")" > "$TMPDIR/log-path"

# should start a verified supervised gateway
unset OPENAI_API_KEY
(cd "$TMPDIR/plugin" && exec openclaw devguard run > "$TMPDIR/run.log" 2>&1) &
echo "$!" > "$TMPDIR/run.pid"
log_path="$(cat "$TMPDIR/log-path")"
run_pid="$(cat "$TMPDIR/run.pid")"
deadline=$((SECONDS + 90))
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
# should infer, build, and expose the separate target plugin
set -o pipefail
grep -F '"id"' "$TMPDIR/plugin/devguard.json" | grep -F '"devguard-example"'
grep -F '"mode"' "$TMPDIR/plugin/devguard.json" | grep -F '"probe"'
grep -F '"DEVGUARD_EXAMPLE_EXEC_ENV"' "$TMPDIR/plugin/devguard.json"
test -f "$TMPDIR/plugin/index.mjs"
(cd "$TMPDIR/plugin" && openclaw devguard doctor) > "$TMPDIR/doctor.log" 2>&1
grep -F "pass" "$TMPDIR/doctor.log" | grep -F "target plugin id"
grep -F "pass" "$TMPDIR/doctor.log" | grep -F "live target plugin"
grep -F "pass" "$TMPDIR/doctor.log" | grep -F "policy hook active"

# should run the live data agent through resolve_exec_env and the exec probe
requested_command="touch \"$TMPDIR/model-exec-sentinel\""
(cd "$TMPDIR/plugin" && openclaw devguard exec -- agent --agent data --session-key devguard-plugin-probe --message "Run the exec tool exactly once with this exact command, then report the tool result without retrying: $requested_command" --json)
log_path="$(cat "$TMPDIR/log-path")"
run_pid="$(cat "$TMPDIR/run.pid")"
deadline=$((SECONDS + 60))
until grep -Fq '"event":"tool_call_probe_completed"' "$log_path" 2>/dev/null; do
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
test ! -e "$TMPDIR/model-exec-sentinel"

# should block filesystem mutation through the live openclaw policy chain
(cd "$TMPDIR/plugin" && openclaw devguard exec -- gateway call devguard-example.attempt-tool --json --params '{"toolName":"write"}') > "$TMPDIR/write-result.json"
grep -F '"blocked"' "$TMPDIR/write-result.json" | grep -F "true"
grep -F '"kind"' "$TMPDIR/write-result.json" | grep -F '"veto"'
test ! -e "$TMPDIR/write-sentinel"

# should deny unknown tools and record redacted correlated decisions
(cd "$TMPDIR/plugin" && openclaw devguard exec -- gateway call devguard-example.attempt-tool --json --params '{"toolName":"totally-unknown-tool"}') > "$TMPDIR/unknown-result.json"
grep -F '"blocked"' "$TMPDIR/unknown-result.json" | grep -F "true"
grep -F '"kind"' "$TMPDIR/unknown-result.json" | grep -F '"veto"'
test ! -e "$TMPDIR/totally-unknown-tool-sentinel"

# should prove resolve_exec_env added devguard_example_exec_env=positronic to the probe process
expected_exec_env="positronic"
expected_exec_env_sha256="$(printf '%s' "$expected_exec_env" | shasum -a 256 | awk '{print $1}')"
test "$(grep -Fc '"event":"tool_call_attempted"' "$log_path")" -eq 3
test "$(grep -Fc '"event":"tool_call_probed"' "$log_path")" -eq 1
test "$(grep -Fc '"event":"tool_call_probe_completed"' "$log_path")" -eq 1
grep -F '"event":"tool_call_probe_completed"' "$log_path" \
  | grep -F '"toolName":"exec"' \
  | grep -F '"agentId":"data"' \
  | grep -F '"originalCommandExecuted":false' \
  | grep -F '"name":"DEVGUARD_EXAMPLE_EXEC_ENV"' \
  | grep -F '"present":true' \
  | grep -F "\"sha256\":\"$expected_exec_env_sha256\""
probe_id="$(grep -F '"event":"tool_call_probed"' "$log_path" | sed -E 's/.*"probeId":"([^"]+)".*/\1/')"
completed_probe_id="$(grep -F '"event":"tool_call_probe_completed"' "$log_path" | sed -E 's/.*"probeId":"([^"]+)".*/\1/')"
test -n "$probe_id"
test "$completed_probe_id" = "$probe_id"

# should prove unsupported decisions are correlated and sensitive values stay hidden
test "$(grep -Fc '"event":"tool_call_blocked"' "$log_path")" -eq 2
grep -F '"event":"tool_call_attempted"' "$log_path" \
  | grep -F '"toolName":"write"' \
  | grep -F '"agentId":"leia-agent"' \
  | grep -F '"runId":"leia-run"' \
  | grep -F '"sessionKey":"agent:leia:main"' \
  | grep -F '"name":"DEVGUARD_TEST_SECRET"' \
  | grep -F '"redacted":true'
grep -F '"event":"tool_call_blocked"' "$log_path" | grep -F '"toolName":"write"'
grep -F '"event":"tool_call_blocked"' "$log_path" | grep -F '"toolName":"totally-unknown-tool"'
if grep -Fq "leia-sensitive-value" "$log_path"; then exit 1; fi
if grep -Fq "$expected_exec_env" "$log_path"; then exit 1; fi
```

## Cleanup

```bash
# should stop supervision cleanly
run_pid="$(cat "$TMPDIR/run.pid")"
kill -TERM "$run_pid"
deadline=$((SECONDS + 20))
while kill -0 "$run_pid" 2>/dev/null; do
  if ((SECONDS >= deadline)); then exit 1; fi
  sleep 1
done
```
