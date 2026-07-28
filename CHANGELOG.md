# Changelog

## {{ UNRELEASED_VERSION }} - [{{ UNRELEASED_DATE }}]({{ UNRELEASED_LINK }})

- Added an installable OpenClaw plugin with an `openclaw devguard` command group and explicit unfinished-command failures.
- Added append-only redacted JSONL records for attempted and blocked tool calls, including safe environment metadata.
- Added CI-first Leia scenarios for packed installation, repeated initialization, and bounded Gateway supervision on macOS and Ubuntu.
- Added fail-closed, high-priority `before_tool_call` enforcement and the live `devguard.status` Gateway RPC.
- Added `openclaw devguard init` and `run` with isolated state, watched rebuilds, owned Gateway restarts, and live build verification.
- Corrected source-linked plugin setup to omit OpenClaw's unsupported `--force` flag.
- Updated the npm package identity to `@tanaab/openclaw-devguard`.
