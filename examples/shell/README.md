# Shell Example

This scenario dogfoods DevGuard's self-target path while verifying that a login shell inherits the caller environment and selects initialized isolated OpenClaw state.

## Setup

```bash
# should install, enable, and initialize devguard
test -f "$DEVGUARD_PACKAGE"
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard
openclaw devguard init "$GITHUB_WORKSPACE"
```

## Testing

```bash
# should enter initialized state from a nested directory
set -o pipefail
printf '%s\n' \
  'set -e' \
  'test "$DEVGUARD_SHELL_SENTINEL" = "retained"' \
  'test "$PWD" = "$GITHUB_WORKSPACE"' \
  'openclaw config get ui.assistant.name --json' |
  DEVGUARD_SHELL_SENTINEL=retained openclaw devguard shell |
  grep -F '"DEVGUARD"'

# should preserve the login shell exit status
status=0
printf '%s\n' 'exit 23' | openclaw devguard shell || status="$?"
test "$status" -eq 23
```
