# Run Example

This scenario initializes a linked fixture plugin under packed DevGuard and verifies one bounded Gateway supervision cycle.

## Setup

```bash
# should prepare the shared fixture plugin
test -f "$DEVGUARD_PACKAGE"
command -v openclaw >/dev/null
cp -R "$GITHUB_WORKSPACE/fixtures/devguard-example-plugin" "$TMPDIR/plugin"

# should install and enable packed devguard
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard

# should initialize the fixture plugin
openclaw devguard init "$TMPDIR/plugin"

# should complete one supervised run
set -o pipefail
(cd "$TMPDIR/plugin" && openclaw devguard run --once) 2>&1 | tee "$TMPDIR/run.log"
```

## Testing

```bash
# should report the verified live build and hook
grep -F "ready        devguard-example" "$TMPDIR/run.log"
grep -F "hook         active" "$TMPDIR/run.log"
```
