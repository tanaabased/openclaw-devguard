# Agent Example

This scenario registers a Devbot workspace and identity through OpenClaw, then verifies that repeatable agent selection retains its safe metadata while keeping agent state and sessions isolated.

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

# should register devbot and load its workspace identity
set -o pipefail
openclaw agents add devbot --workspace "$TMPDIR/source-devbot" --non-interactive --json | grep -F '"agentId"' | grep -F '"devbot"'
openclaw agents set-identity --agent devbot --workspace "$TMPDIR/source-devbot" --from-identity --json | grep -F '"avatar"' | grep -F '"assets/devbot.png"'
test ! -e "$TMPDIR/source-devbot/BOOTSTRAP.md"

# should install and enable packed devguard in the source profile
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard
cp "$OPENCLAW_STATE_DIR/openclaw.json" "$TMPDIR/source-before.json"

# should initialize the fixture with an additional agent and no model transfer
openclaw devguard init "$TMPDIR/plugin" --agent devbot --no-model-profile > "$TMPDIR/init.log" 2>&1
find "$DEVGUARD_HOME/projects" -path '*/state/openclaw.json' -print -quit > "$TMPDIR/config-path"
dirname "$(cat "$TMPDIR/config-path")" > "$TMPDIR/state-path"
```

## Testing

```bash
# should retain source workspaces while isolating agent state and sessions
cmp "$TMPDIR/source-before.json" "$OPENCLAW_STATE_DIR/openclaw.json"
node "$GITHUB_WORKSPACE/scripts/leia-profile-cli.mjs" assert-agent "$(cat "$TMPDIR/state-path")" "$OPENCLAW_STATE_DIR"

# should report both agents and the disabled model transfer
set -o pipefail
grep -F "agents" "$TMPDIR/init.log" | grep -F "main, devbot"
grep -F "model" "$TMPDIR/init.log" | grep -F "not imported"
grep -F "auth" "$TMPDIR/init.log" | grep -F "not imported"
```
