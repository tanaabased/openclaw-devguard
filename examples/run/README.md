# Run Example

This scenario uses packed DevGuard to initialize the repository as its own target and verifies one bounded Gateway supervision cycle.

## Setup

```bash
# should prepare the devguard repository
test -f "$DEVGUARD_PACKAGE"
command -v openclaw >/dev/null
test -f "$GITHUB_WORKSPACE/devguard.json"

# should install and enable packed devguard
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" plugins install "$DEVGUARD_PACKAGE" --force
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" plugins enable openclaw-devguard

# should initialize devguard as its own target
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" devguard init "$GITHUB_WORKSPACE"

# should complete one supervised run
set -o pipefail
(cd "$GITHUB_WORKSPACE" && openclaw --profile "$OPENCLAW_SOURCE_PROFILE" devguard run --once) 2>&1 | tee "$TMPDIR/run.log"
```

## Testing

```bash
# should report the verified live build and hook
set -o pipefail
grep -F "ready" "$TMPDIR/run.log" | grep -F "openclaw-devguard"
grep -F "hook" "$TMPDIR/run.log" | grep -F "active"
```
