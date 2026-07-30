# Exec Example

This scenario dogfoods DevGuard's self-target path while verifying that native OpenClaw commands can run directly against initialized isolated state.

## Setup

```bash
# should install, enable, and initialize devguard
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard
openclaw devguard init "$GITHUB_WORKSPACE"
```

## Testing

```bash
# should forward native arguments and read isolated configuration
set -o pipefail
openclaw devguard exec -- config get ui.assistant.name --json | grep -F '"DEVGUARD"'
openclaw devguard exec -- config file | grep -F ".openclaw-devguard-openclaw-devguard-"

# should preserve a native command failure
if openclaw devguard exec -- config get devguard.missing --json > "$TMPDIR/missing.log" 2>&1; then exit 1; fi
if grep -Fq 'exec failed' "$TMPDIR/missing.log"; then cat "$TMPDIR/missing.log"; exit 1; fi
```
