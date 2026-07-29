# Agent Example

This scenario dogfoods DevGuard's self-target path with two source agents. Picard has identity persisted in the source profile, while Riker has identity only in his workspace. The scenario verifies that DevGuard reproduces both identities in isolated state without adding Riker's identity to the source profile.

## Setup

```bash
# should prepare the picard and riker workspaces and devguard target
test -f "$DEVGUARD_PACKAGE"
test -f "$GITHUB_WORKSPACE/examples/agent/picard/IDENTITY.md"
test -f "$GITHUB_WORKSPACE/examples/agent/picard/avatar.png"
test -f "$GITHUB_WORKSPACE/examples/agent/riker/IDENTITY.md"
test -f "$GITHUB_WORKSPACE/examples/agent/riker/avatar.png"
cp -R "$GITHUB_WORKSPACE/examples/agent/picard" "$TMPDIR/source-picard"
cp -R "$GITHUB_WORKSPACE/examples/agent/riker" "$TMPDIR/source-riker"

# should register both agents and persist only picard identity in the source profile
set -o pipefail
openclaw agents add picard --workspace "$TMPDIR/source-picard" --non-interactive --json | grep -F '"agentId"' | grep -F '"picard"'
openclaw agents add riker --workspace "$TMPDIR/source-riker" --non-interactive --json | grep -F '"agentId"' | grep -F '"riker"'
openclaw agents set-identity --agent picard --workspace "$TMPDIR/source-picard" --from-identity --json | grep -F '"agentId"' | grep -F '"picard"'
openclaw config get 'agents.list[0].id' --json | grep -F '"main"'
openclaw config get 'agents.list[1].id' --json | grep -F '"picard"'
openclaw config get 'agents.list[1].identity.name' --json | grep -F '"Jean-Luc Picard"'
openclaw config get 'agents.list[2].id' --json | grep -F '"riker"'
if openclaw config get 'agents.list[2].identity' --json > "$TMPDIR/source-riker-identity.log" 2>&1; then exit 1; fi
test ! -e "$TMPDIR/source-picard/BOOTSTRAP.md"
test ! -e "$TMPDIR/source-riker/BOOTSTRAP.md"

# should install and enable packed devguard in the source profile
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard
cp "$OPENCLAW_STATE_DIR/openclaw.json" "$TMPDIR/source-before.json"

# should initialize devguard with both agents and no model transfer
openclaw devguard init "$GITHUB_WORKSPACE" --agent picard --agent riker --no-model-profile > "$TMPDIR/init.log" 2>&1
find "$DEVGUARD_HOME/projects" -path '*/state/openclaw.json' -print -quit > "$TMPDIR/config-path"
dirname "$(cat "$TMPDIR/config-path")" > "$TMPDIR/state-path"
dirname "$(dirname "$(cat "$TMPDIR/config-path")")" > "$TMPDIR/project-path"
printf '%s/logs/events.jsonl\n' "$(cat "$TMPDIR/project-path")" > "$TMPDIR/log-path"

# should start the isolated gateway with both imported identities
(cd "$GITHUB_WORKSPACE" && exec openclaw devguard run > "$TMPDIR/run.log" 2>&1) &
echo "$!" > "$TMPDIR/run.pid"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" wait-text "$(cat "$TMPDIR/log-path")" '"event":"target_plugin_loaded"' 1 60 "$(cat "$TMPDIR/run.pid")"
```

## Testing

```bash
# should retain the source workspaces and reproduce both identities only in isolated state
set -o pipefail
cmp "$TMPDIR/source-before.json" "$OPENCLAW_STATE_DIR/openclaw.json"
OPENCLAW_STATE_DIR="$(cat "$TMPDIR/state-path")" openclaw config get 'agents.list[0].id' --json | grep -F '"main"'
OPENCLAW_STATE_DIR="$(cat "$TMPDIR/state-path")" openclaw config get 'agents.list[0].default' --json | grep -F 'true'
OPENCLAW_STATE_DIR="$(cat "$TMPDIR/state-path")" openclaw config get 'agents.list[1].id' --json | grep -F '"picard"'
OPENCLAW_STATE_DIR="$(cat "$TMPDIR/state-path")" openclaw config get 'agents.list[1].identity.name' --json | grep -F '"Jean-Luc Picard"'
OPENCLAW_STATE_DIR="$(cat "$TMPDIR/state-path")" openclaw config get 'agents.list[1].workspace' --json | grep -F "$TMPDIR/source-picard"
OPENCLAW_STATE_DIR="$(cat "$TMPDIR/state-path")" openclaw config get 'agents.list[1].agentDir' --json | grep -F "$(cat "$TMPDIR/state-path")/agents/picard/agent"
OPENCLAW_STATE_DIR="$(cat "$TMPDIR/state-path")" openclaw config get 'agents.list[2].id' --json | grep -F '"riker"'
OPENCLAW_STATE_DIR="$(cat "$TMPDIR/state-path")" openclaw config get 'agents.list[2].identity.name' --json | grep -F '"William T. Riker"'
OPENCLAW_STATE_DIR="$(cat "$TMPDIR/state-path")" openclaw config get 'agents.list[2].workspace' --json | grep -F "$TMPDIR/source-riker"
OPENCLAW_STATE_DIR="$(cat "$TMPDIR/state-path")" openclaw config get 'agents.list[2].agentDir' --json | grep -F "$(cat "$TMPDIR/state-path")/agents/riker/agent"
OPENCLAW_STATE_DIR="$(cat "$TMPDIR/state-path")" openclaw config get ui.assistant.name --json | grep -F '"DEVGUARD"'
OPENCLAW_STATE_DIR="$(cat "$TMPDIR/state-path")" openclaw config get ui.assistant.avatar --json | grep -Fq '"data:image/png;base64,'

# should report all agents and the disabled model transfer
set -o pipefail
grep -F "agents" "$TMPDIR/init.log" | grep -F "main, picard, riker"
grep -F "model" "$TMPDIR/init.log" | grep -F "not imported"
grep -F "auth" "$TMPDIR/init.log" | grep -F "not imported"

# should expose both identities through the live gateway
set -o pipefail
OPENCLAW_STATE_DIR="$(cat "$TMPDIR/state-path")" openclaw gateway call agents.list --json > "$TMPDIR/agents-list.json"
grep -F '"defaultId"' "$TMPDIR/agents-list.json" | grep -F '"main"'
grep -F '"id"' "$TMPDIR/agents-list.json" | grep -F '"picard"'
grep -F '"id"' "$TMPDIR/agents-list.json" | grep -F '"riker"'
OPENCLAW_STATE_DIR="$(cat "$TMPDIR/state-path")" openclaw gateway call agent.identity.get --json --params '{"agentId":"main"}' > "$TMPDIR/main-identity.json"
grep -F '"agentId"' "$TMPDIR/main-identity.json" | grep -F '"main"'
grep -F '"name"' "$TMPDIR/main-identity.json" | grep -F '"DEVGUARD"'
grep -F '"avatarStatus"' "$TMPDIR/main-identity.json" | grep -F '"data"'
OPENCLAW_STATE_DIR="$(cat "$TMPDIR/state-path")" openclaw gateway call agent.identity.get --json --params '{"agentId":"picard"}' > "$TMPDIR/picard-identity.json"
grep -F '"agentId"' "$TMPDIR/picard-identity.json" | grep -F '"picard"'
grep -F '"name"' "$TMPDIR/picard-identity.json" | grep -F '"Jean-Luc Picard"'
grep -F '"avatarStatus"' "$TMPDIR/picard-identity.json" | grep -F '"local"'
OPENCLAW_STATE_DIR="$(cat "$TMPDIR/state-path")" openclaw gateway call agent.identity.get --json --params '{"agentId":"riker"}' > "$TMPDIR/riker-identity.json"
grep -F '"agentId"' "$TMPDIR/riker-identity.json" | grep -F '"riker"'
grep -F '"name"' "$TMPDIR/riker-identity.json" | grep -F '"William T. Riker"'
grep -F '"avatarStatus"' "$TMPDIR/riker-identity.json" | grep -F '"local"'
cmp "$TMPDIR/source-before.json" "$OPENCLAW_STATE_DIR/openclaw.json"
cmp "$GITHUB_WORKSPACE/examples/agent/picard/IDENTITY.md" "$TMPDIR/source-picard/IDENTITY.md"
cmp "$GITHUB_WORKSPACE/examples/agent/picard/avatar.png" "$TMPDIR/source-picard/avatar.png"
cmp "$GITHUB_WORKSPACE/examples/agent/riker/IDENTITY.md" "$TMPDIR/source-riker/IDENTITY.md"
cmp "$GITHUB_WORKSPACE/examples/agent/riker/avatar.png" "$TMPDIR/source-riker/avatar.png"
```

## Cleanup

```bash
# should stop live supervision cleanly
kill -TERM "$(cat "$TMPDIR/run.pid")"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" wait-exit "$(cat "$TMPDIR/run.pid")" 20
```
