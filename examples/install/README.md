# Install Example

This scenario installs the packed DevGuard package into isolated OpenClaw state and verifies its runtime and lightweight CLI contract.

## Setup

```bash
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
set -o pipefail
openclaw devguard --help > "$TMPDIR/devguard-help"
grep -F "init" "$TMPDIR/devguard-help"
grep -F "profile" "$TMPDIR/devguard-help"
grep -F "exec" "$TMPDIR/devguard-help"
grep -F "shell" "$TMPDIR/devguard-help"
grep -F "run" "$TMPDIR/devguard-help"
grep -F "doctor" "$TMPDIR/devguard-help"
grep -F "restore" "$TMPDIR/devguard-help"
openclaw devguard exec --help | grep -F "<openclaw-args...>"
openclaw devguard shell --help | grep -F "login shell"
openclaw devguard run --help | grep -F -- "--once"
openclaw devguard run --help | grep -F -- "--startup-timeout <seconds>"
openclaw devguard tail --help | grep -F -- "--no-follow"
```
