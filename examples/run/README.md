# Run Example

This scenario uses packed DevGuard to initialize the repository as its own target and verifies one bounded Gateway supervision cycle.

## Setup

```bash
# should install and enable packed devguard
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard

# should initialize devguard as its own target
openclaw devguard init "$GITHUB_WORKSPACE"

# should complete one supervised run
set -o pipefail
(cd "$GITHUB_WORKSPACE" && openclaw devguard run --once) 2>&1 | tee "$TMPDIR/run.log"
```

## Testing

```bash
# should report the verified live build and hook
grep -F "ready" "$TMPDIR/run.log" | grep -F "openclaw-devguard"
grep -F "hook" "$TMPDIR/run.log" | grep -F "active"
```
