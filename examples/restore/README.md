# Restore Example

This scenario dogfoods DevGuard's self-target path while verifying generated-state removal, saved-config restoration, log preservation, and repeated restore behavior.

## Setup

```bash
# should prepare and initialize devguard as its own target
test -f "$DEVGUARD_PACKAGE"
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" plugins install "$DEVGUARD_PACKAGE" --force
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" plugins enable openclaw-devguard
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" devguard init "$GITHUB_WORKSPACE"
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" devguard profile "$GITHUB_WORKSPACE" > "$TMPDIR/devguard-profile"
openclaw --profile "$(cat "$TMPDIR/devguard-profile")" config file | sed "s|^~|$HOME|" > "$TMPDIR/config-path"
test -s "$TMPDIR/config-path"

# should remove state that devguard generated from an empty profile
(cd "$GITHUB_WORKSPACE" && openclaw --profile "$OPENCLAW_SOURCE_PROFILE" devguard restore)
test ! -e "$(cat "$TMPDIR/config-path")"

# should initialize over an existing development profile fixture
mkdir -p "$(dirname "$(cat "$TMPDIR/config-path")")"
cp "$GITHUB_WORKSPACE/examples/restore/prior-openclaw.json" "$(cat "$TMPDIR/config-path")"
openclaw --profile "$OPENCLAW_SOURCE_PROFILE" devguard init "$GITHUB_WORKSPACE"
```

## Testing

```bash
# should restore the saved config and preserve the append-only log
set -o pipefail
(cd "$GITHUB_WORKSPACE" && openclaw --profile "$OPENCLAW_SOURCE_PROFILE" devguard restore) | grep -F "logs" | grep -F "preserved"
cmp "$GITHUB_WORKSPACE/examples/restore/prior-openclaw.json" "$(cat "$TMPDIR/config-path")"
find "$DEVGUARD_HOME/projects" -path '*/logs/events.jsonl' -print -quit > "$TMPDIR/log-path"
grep -F '"event":"configuration_restored"' "$(cat "$TMPDIR/log-path")"

# should make repeated restore a successful no-op
set -o pipefail
(cd "$GITHUB_WORKSPACE" && openclaw --profile "$OPENCLAW_SOURCE_PROFILE" devguard restore) | grep -F "unchanged" | grep -F "openclaw-devguard"
cmp "$GITHUB_WORKSPACE/examples/restore/prior-openclaw.json" "$(cat "$TMPDIR/config-path")"
```
