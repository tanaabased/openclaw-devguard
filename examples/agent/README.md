# Agent Example

This scenario dogfoods DevGuard's self-target path with two source agents. Picard has identity persisted in the source profile, while Riker has identity only in his workspace. The scenario verifies that DevGuard reproduces both identities in isolated state without adding Riker's identity to the source profile.

## Setup

```bash
# should prepare the picard and riker workspaces and devguard target
cp -R "$GITHUB_WORKSPACE/examples/agent/picard" "$TMPDIR/source-picard"
cp -R "$GITHUB_WORKSPACE/examples/agent/riker" "$TMPDIR/source-riker"

# should register both agents and persist only picard identity in the source profile
openclaw agents add picard --workspace "$TMPDIR/source-picard" --non-interactive
openclaw agents add riker --workspace "$TMPDIR/source-riker" --non-interactive
openclaw agents set-identity --agent picard --workspace "$TMPDIR/source-picard" --from-identity
if openclaw config get 'agents.list[2].identity' --json > "$TMPDIR/source-riker-identity.log" 2>&1; then exit 1; fi

# should install and enable packed devguard in the source profile
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard
openclaw config file | sed "s|^~|$HOME|" > "$TMPDIR/source-config-path"
cp "$(cat "$TMPDIR/source-config-path")" "$TMPDIR/source-before.json"

# should initialize devguard with both agents and no model transfer
openclaw devguard init "$GITHUB_WORKSPACE" --agent picard --agent riker --no-model-profile > "$TMPDIR/init.log" 2>&1
openclaw devguard exec -- config file | sed "s|^~|$HOME|" > "$TMPDIR/config-path"
dirname "$(cat "$TMPDIR/config-path")" > "$TMPDIR/state-path"
find "$DEVGUARD_HOME/projects" -name init.json -print -quit > "$TMPDIR/marker-path"
dirname "$(cat "$TMPDIR/marker-path")" > "$TMPDIR/project-path"
printf '%s/logs/events.jsonl\n' "$(cat "$TMPDIR/project-path")" > "$TMPDIR/log-path"

# should start the isolated gateway with both imported identities
(cd "$GITHUB_WORKSPACE" && exec openclaw devguard run > "$TMPDIR/run.log" 2>&1) &
echo "$!" > "$TMPDIR/run.pid"
"$GITHUB_WORKSPACE/examples/agent/wait-for-plugin-load.sh"
```

## Testing

```bash
# should route both agents to their source workspaces and isolated state
set -o pipefail
openclaw devguard exec -- config get 'agents.list[0].default' --json | grep -F 'true'
openclaw devguard exec -- config get 'agents.list[1].workspace' --json | grep -F "$TMPDIR/source-picard"
openclaw devguard exec -- config get 'agents.list[1].agentDir' --json | grep -F "$(cat "$TMPDIR/state-path")/agents/picard/agent"
openclaw devguard exec -- config get 'agents.list[2].workspace' --json | grep -F "$TMPDIR/source-riker"
openclaw devguard exec -- config get 'agents.list[2].agentDir' --json | grep -F "$(cat "$TMPDIR/state-path")/agents/riker/agent"
openclaw devguard exec -- config get ui.assistant.name --json | grep -F '"DEVGUARD"'
openclaw devguard exec -- config get ui.assistant.avatar --json | grep -Fq '"data:image/png;base64,'

# should report all agents and the disabled model transfer
grep -F "agents" "$TMPDIR/init.log" | grep -F "main, picard, riker"
grep -F "model" "$TMPDIR/init.log" | grep -F "not imported"
grep -F "auth" "$TMPDIR/init.log" | grep -F "not imported"

# should expose both identities through the live gateway
openclaw devguard exec -- gateway call agents.list --json > "$TMPDIR/agents-list.json"
grep -F '"defaultId"' "$TMPDIR/agents-list.json" | grep -F '"main"'
grep -F '"id"' "$TMPDIR/agents-list.json" | grep -F '"picard"'
grep -F '"id"' "$TMPDIR/agents-list.json" | grep -F '"riker"'
openclaw devguard exec -- gateway call agent.identity.get --json --params '{"agentId":"main"}' > "$TMPDIR/main-identity.json"
grep -F '"agentId"' "$TMPDIR/main-identity.json" | grep -F '"main"'
grep -F '"name"' "$TMPDIR/main-identity.json" | grep -F '"DEVGUARD"'
grep -F '"avatarStatus"' "$TMPDIR/main-identity.json" | grep -F '"data"'
openclaw devguard exec -- gateway call agent.identity.get --json --params '{"agentId":"picard"}' > "$TMPDIR/picard-identity.json"
grep -F '"agentId"' "$TMPDIR/picard-identity.json" | grep -F '"picard"'
grep -F '"name"' "$TMPDIR/picard-identity.json" | grep -F '"Jean-Luc Picard"'
grep -F '"avatarStatus"' "$TMPDIR/picard-identity.json" | grep -F '"local"'
openclaw devguard exec -- gateway call agent.identity.get --json --params '{"agentId":"riker"}' > "$TMPDIR/riker-identity.json"
grep -F '"agentId"' "$TMPDIR/riker-identity.json" | grep -F '"riker"'
grep -F '"name"' "$TMPDIR/riker-identity.json" | grep -F '"William T. Riker"'
grep -F '"avatarStatus"' "$TMPDIR/riker-identity.json" | grep -F '"local"'

# should leave the source profile and workspace fixtures unchanged
cmp "$TMPDIR/source-before.json" "$(cat "$TMPDIR/source-config-path")"
cmp "$GITHUB_WORKSPACE/examples/agent/picard/IDENTITY.md" "$TMPDIR/source-picard/IDENTITY.md"
cmp "$GITHUB_WORKSPACE/examples/agent/picard/avatar.png" "$TMPDIR/source-picard/avatar.png"
cmp "$GITHUB_WORKSPACE/examples/agent/riker/IDENTITY.md" "$TMPDIR/source-riker/IDENTITY.md"
cmp "$GITHUB_WORKSPACE/examples/agent/riker/avatar.png" "$TMPDIR/source-riker/avatar.png"
```

## Cleanup

```bash
# should stop live supervision cleanly
"$GITHUB_WORKSPACE/examples/agent/stop-supervision.sh"
```
