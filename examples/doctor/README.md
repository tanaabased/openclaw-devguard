# Doctor Example

This scenario keeps a supervised Gateway live while DevGuard aggregates its safety and OpenClaw diagnostics.

## Setup

```bash
# should prepare and initialize the fixture plugin
test -f "$DEVGUARD_PACKAGE"
cp -R "$GITHUB_WORKSPACE/fixtures/devguard-example-plugin" "$TMPDIR/plugin"
openclaw plugins install "$DEVGUARD_PACKAGE" --force
openclaw plugins enable openclaw-devguard
openclaw devguard init "$TMPDIR/plugin"

# should start a verified supervised gateway
(cd "$TMPDIR/plugin" && exec openclaw devguard run > "$TMPDIR/run.log" 2>&1) &
echo "$!" > "$TMPDIR/run.pid"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" wait-text "$TMPDIR/run.log" "ready        devguard-example" 1 60
```

## Testing

```bash
# should pass the aggregate safety and runtime doctor
set -o pipefail
(cd "$TMPDIR/plugin" && openclaw devguard doctor) 2>&1 | tee "$TMPDIR/doctor.log"
grep -F "pass         isolated profile active" "$TMPDIR/doctor.log"
grep -F "pass         unknown tools denied" "$TMPDIR/doctor.log"
grep -F "pass         current plugin build" "$TMPDIR/doctor.log"

# should stop supervision cleanly
kill -TERM "$(cat "$TMPDIR/run.pid")"
node "$GITHUB_WORKSPACE/scripts/leia-check-cli.mjs" wait-exit "$(cat "$TMPDIR/run.pid")" 20
```
