# Init Example

This scenario installs packed DevGuard, initializes a linked fixture plugin, and verifies that repeated initialization reuses its generated state.

## Setup

```bash
# should prepare the shared fixture plugin
test -f "$DEVGUARD_PACKAGE"
command -v openclaw >/dev/null
cp -R "$GITHUB_WORKSPACE/fixtures/devguard-example-plugin" "$TMPDIR/plugin"

# should install and enable packed devguard
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard

# should initialize the fixture plugin and report created config
set -o pipefail
openclaw devguard init "$TMPDIR/plugin" 2>&1 | grep -F "config" | grep -F "created"

# should reuse initialization on a second run
set -o pipefail
openclaw devguard init "$TMPDIR/plugin" 2>&1 | grep -F "config" | grep -F "reused"
```

## Testing

```bash
# should create the inferred project configuration
set -o pipefail
test -f "$TMPDIR/plugin/devguard.json"
grep -F '"id"' "$TMPDIR/plugin/devguard.json" | grep -F '"devguard-example"'

# should build the fixture plugin
test -f "$TMPDIR/plugin/dist/index.js"
```
