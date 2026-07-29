# Init Example

This scenario installs packed DevGuard, initializes the DevGuard repository as its own target, and verifies that repeated initialization reuses its checked-in project configuration.

## Setup

```bash
# should prepare the devguard repository
test -f "$DEVGUARD_PACKAGE"
command -v openclaw >/dev/null
test -f "$GITHUB_WORKSPACE/devguard.json"

# should install and enable packed devguard
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard

# should initialize devguard as its own target and report reused config
set -o pipefail
openclaw devguard init "$GITHUB_WORKSPACE" 2>&1 | grep -F "config" | grep -F "reused"

# should reuse initialization on a second run
set -o pipefail
openclaw devguard init "$GITHUB_WORKSPACE" 2>&1 | grep -F "config" | grep -F "reused"
```

## Testing

```bash
# should retain the self-target project configuration
set -o pipefail
test -f "$GITHUB_WORKSPACE/devguard.json"
grep -F '"id"' "$GITHUB_WORKSPACE/devguard.json" | grep -F '"openclaw-devguard"'

# should build devguard for the isolated gateway
test -f "$GITHUB_WORKSPACE/dist/index.js"
```
