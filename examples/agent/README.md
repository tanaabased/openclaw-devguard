# Agent Example

This scenario registers a Devbot workspace without persisting its identity in the source profile, then verifies that DevGuard loads the workspace identity only into isolated state and exposes it through the live Gateway.

## Setup

```bash
# should prepare the devbot workspace and fixture plugin
test -f "$DEVGUARD_PACKAGE"
cp -R "$GITHUB_WORKSPACE/fixtures/devguard-example-plugin" "$TMPDIR/plugin"
cp -R "$GITHUB_WORKSPACE/fixtures/devbot-agent-workspace" "$TMPDIR/source-devbot"
mkdir -p "$TMPDIR/source-devbot/assets"
cp "$GITHUB_WORKSPACE/assets/devbot.png" "$TMPDIR/source-devbot/assets/devbot.png"
test -f "$TMPDIR/source-devbot/IDENTITY.md"
test -f "$TMPDIR/source-devbot/assets/devbot.png"

# should register devbot without persisting its workspace identity
set -o pipefail
openclaw agents add devbot --workspace "$TMPDIR/source-devbot" --non-interactive --json | grep -F '"agentId"' | grep -F '"devbot"'
openclaw config get agents.list --json > "$TMPDIR/source-agents.json"
grep -F '"devbot"' "$TMPDIR/source-agents.json"
if grep -Fq '"identity"' "$TMPDIR/source-agents.json"; then exit 1; fi
test ! -e "$TMPDIR/source-devbot/BOOTSTRAP.md"

# should install and enable packed devguard in the source profile
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard
cp "$OPENCLAW_STATE_DIR/openclaw.json" "$TMPDIR/source-before.json"

# should initialize the fixture with an additional agent and no model transfer
openclaw devguard init "$TMPDIR/plugin" --agent devbot --no-model-profile > "$TMPDIR/init.log" 2>&1
find "$DEVGUARD_HOME/projects" -path '*/state/openclaw.json' -print -quit > "$TMPDIR/config-path"
dirname "$(cat "$TMPDIR/config-path")" > "$TMPDIR/state-path"
dirname "$(dirname "$(cat "$TMPDIR/config-path")")" > "$TMPDIR/project-path"
printf '%s/logs/events.jsonl\n' "$(cat "$TMPDIR/project-path")" > "$TMPDIR/log-path"

# should start the isolated gateway with the imported workspace identity
(cd "$TMPDIR/plugin" && exec openclaw devguard run > "$TMPDIR/run.log" 2>&1) &
echo "$!" > "$TMPDIR/run.pid"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" wait-text "$(cat "$TMPDIR/log-path")" '"event":"target_plugin_loaded"' 1 60 "$(cat "$TMPDIR/run.pid")"
```

## Testing

```bash
# should retain the source workspace and materialize identity only in isolated state
cmp "$TMPDIR/source-before.json" "$OPENCLAW_STATE_DIR/openclaw.json"
OPENCLAW_STATE_DIR="$(cat "$TMPDIR/state-path")" openclaw config get agents.list --json > "$TMPDIR/isolated-agents.json"
grep -F '"main"' "$TMPDIR/isolated-agents.json"
grep -F '"devbot"' "$TMPDIR/isolated-agents.json"
grep -F '"identity"' "$TMPDIR/isolated-agents.json"
grep -F "$TMPDIR/source-devbot" "$TMPDIR/isolated-agents.json"
grep -F "$(cat "$TMPDIR/state-path")/agents/devbot/agent" "$TMPDIR/isolated-agents.json"

# should report both agents and the disabled model transfer
set -o pipefail
grep -F "agents" "$TMPDIR/init.log" | grep -F "main, devbot"
grep -F "model" "$TMPDIR/init.log" | grep -F "not imported"
grep -F "auth" "$TMPDIR/init.log" | grep -F "not imported"

# should expose devbot identity through both live gateway surfaces
OPENCLAW_STATE_DIR="$(cat "$TMPDIR/state-path")" openclaw gateway call agents.list --json > "$TMPDIR/agents-list.json"
grep -F '"defaultId"' "$TMPDIR/agents-list.json" | grep -F '"main"'
grep -F '"id"' "$TMPDIR/agents-list.json" | grep -F '"devbot"'
grep -F '"identity"' "$TMPDIR/agents-list.json"
OPENCLAW_STATE_DIR="$(cat "$TMPDIR/state-path")" openclaw gateway call agent.identity.get --json --params '{"agentId":"devbot"}' > "$TMPDIR/agent-identity.json"
grep -F '"agentId"' "$TMPDIR/agent-identity.json" | grep -F '"devbot"'
grep -F '"avatarStatus"' "$TMPDIR/agent-identity.json" | grep -F '"local"'
cmp "$TMPDIR/source-before.json" "$OPENCLAW_STATE_DIR/openclaw.json"
cmp "$GITHUB_WORKSPACE/fixtures/devbot-agent-workspace/IDENTITY.md" "$TMPDIR/source-devbot/IDENTITY.md"
cmp "$GITHUB_WORKSPACE/assets/devbot.png" "$TMPDIR/source-devbot/assets/devbot.png"
```

## Cleanup

```bash
# should stop live supervision cleanly
kill -TERM "$(cat "$TMPDIR/run.pid")"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" wait-exit "$(cat "$TMPDIR/run.pid")" 20
```
