# Restore Example

This scenario verifies generated-state removal, saved-config restoration, log preservation, and repeated restore behavior.

## Setup

```bash
# should prepare and initialize the fixture plugin
test -f "$DEVGUARD_PACKAGE"
cp -R "$GITHUB_WORKSPACE/examples/fixtures/plugin" "$TMPDIR/plugin"
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard
openclaw devguard init "$TMPDIR/plugin"
find "$DEVGUARD_HOME/projects" -path '*/state/openclaw.json' -print -quit > "$TMPDIR/config-path"
test -s "$TMPDIR/config-path"

# should remove state that devguard generated from an empty profile
(cd "$TMPDIR/plugin" && openclaw devguard restore) > "$TMPDIR/restore-generated.log"
test ! -e "$(cat "$TMPDIR/config-path")"

# should initialize over an existing development profile config
mkdir -p "$(dirname "$(cat "$TMPDIR/config-path")")"
printf '{}\n' > "$TMPDIR/prior-openclaw.json"
cp "$TMPDIR/prior-openclaw.json" "$(cat "$TMPDIR/config-path")"
openclaw devguard init "$TMPDIR/plugin"
```

## Testing

```bash
# should restore the saved config and preserve the append-only log
(cd "$TMPDIR/plugin" && openclaw devguard restore) > "$TMPDIR/restore-snapshot.log"
cmp "$TMPDIR/prior-openclaw.json" "$(cat "$TMPDIR/config-path")"
find "$DEVGUARD_HOME/projects" -path '*/logs/events.jsonl' -print -quit > "$TMPDIR/log-path"
grep -F '"event":"configuration_restored"' "$(cat "$TMPDIR/log-path")"
grep -F "logs         preserved" "$TMPDIR/restore-snapshot.log"

# should make repeated restore a successful no-op
(cd "$TMPDIR/plugin" && openclaw devguard restore) > "$TMPDIR/restore-again.log"
grep -F "unchanged    devguard-example" "$TMPDIR/restore-again.log"
cmp "$TMPDIR/prior-openclaw.json" "$(cat "$TMPDIR/config-path")"
```
