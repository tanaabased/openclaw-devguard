# Agent Example

This scenario verifies that a repeatable agent selection resolves source workspaces while keeping agent state and sessions isolated.

## Setup

```bash
# should prepare source agents and the fixture plugin
test -f "$DEVGUARD_PACKAGE"
cp -R "$GITHUB_WORKSPACE/examples/fixtures/plugin" "$TMPDIR/plugin"
node "$GITHUB_WORKSPACE/examples/support/profile.mjs" seed-agent

# should install and enable packed devguard in the source profile
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard
cp "$OPENCLAW_STATE_DIR/openclaw.json" "$TMPDIR/source-before.json"

# should initialize the fixture with an additional agent and no model transfer
openclaw devguard init "$TMPDIR/plugin" --agent ops --no-model-profile > "$TMPDIR/init.log" 2>&1
find "$DEVGUARD_HOME/projects" -path '*/state/openclaw.json' -print -quit > "$TMPDIR/config-path"
dirname "$(cat "$TMPDIR/config-path")" > "$TMPDIR/state-path"
```

## Testing

```bash
# should retain source workspaces while isolating agent state and sessions
cmp "$TMPDIR/source-before.json" "$OPENCLAW_STATE_DIR/openclaw.json"
node "$GITHUB_WORKSPACE/examples/support/profile.mjs" assert-agent "$(cat "$TMPDIR/state-path")" "$OPENCLAW_STATE_DIR"

# should report both agents and the disabled model transfer
grep -F "agents       main, ops" "$TMPDIR/init.log"
grep -F "model        not imported" "$TMPDIR/init.log"
grep -F "auth         not imported" "$TMPDIR/init.log"
```
