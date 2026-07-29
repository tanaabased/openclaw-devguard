# Install Example

This scenario installs the packed DevGuard package into isolated OpenClaw state and verifies its runtime and lightweight CLI contract.

## Setup

```bash
# should provide the packed plugin and openclaw cli
test -f "$DEVGUARD_PACKAGE"
command -v openclaw >/dev/null

# should install and enable the packed plugin
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard
```

## Testing

```bash
# should load the packed runtime from dist
set -o pipefail
openclaw plugins inspect openclaw-devguard --runtime --json | tee "$TMPDIR/inspection.json"
grep -F "openclaw-devguard" "$TMPDIR/inspection.json"
grep -F "dist/index.js" "$TMPDIR/inspection.json"

# should pass openclaw plugin diagnostics
openclaw plugins doctor

# should expose the lightweight devguard command contract
openclaw devguard --help | grep -F "init"
openclaw devguard --help | grep -F "profile"
openclaw devguard --help | grep -F "exec"
openclaw devguard exec --help | grep -F "<openclaw-args...>"
openclaw devguard --help | grep -F "run"
openclaw devguard run --help | grep -F -- "--once"
openclaw devguard run --help | grep -F -- "--startup-timeout <seconds>"
openclaw devguard tail --help | grep -F -- "--no-follow"
openclaw devguard --help | grep -F "doctor"
openclaw devguard --help | grep -F "restore"
```
