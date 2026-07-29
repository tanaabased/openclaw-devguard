# Install Example

This scenario installs the packed DevGuard package into isolated OpenClaw state and verifies its runtime and lightweight CLI contract.

## Setup

```bash
# should provide the packed plugin and openclaw cli
test -f "$DEVGUARD_PACKAGE"
command -v openclaw >/dev/null

# should install and enable the packed plugin
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" plugins install "$DEVGUARD_PACKAGE" --force
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" plugins enable openclaw-devguard
```

## Testing

```bash
# should load the packed runtime from dist
set -o pipefail
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" plugins inspect openclaw-devguard --runtime --json | tee "$TMPDIR/inspection.json"
grep -F "openclaw-devguard" "$TMPDIR/inspection.json"
grep -F "dist/index.js" "$TMPDIR/inspection.json"

# should pass openclaw plugin diagnostics
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" plugins doctor

# should expose the lightweight devguard command contract
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" devguard --help | grep -F "init"
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" devguard --help | grep -F "profile"
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" devguard --help | grep -F "run"
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" devguard run --help | grep -F -- "--once"
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" devguard run --help | grep -F -- "--startup-timeout <seconds>"
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" devguard tail --help | grep -F -- "--no-follow"
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" devguard --help | grep -F "doctor"
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" devguard --help | grep -F "restore"
```
