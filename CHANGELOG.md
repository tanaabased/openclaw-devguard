# Changelog

## {{ UNRELEASED_VERSION }} - [{{ UNRELEASED_DATE }}]({{ UNRELEASED_LINK }})

- Added a Bun and TypeScript development baseline with an owned-Gateway watch loop.
- Added append-only redacted JSONL records for attempted and blocked tool calls, including safe environment metadata.
- Added fail-closed, high-priority `before_tool_call` enforcement and the live `devguard.status` Gateway RPC.
- Added functional `openclaw devguard init` and `run` flows for isolated setup, rebuilds, restarts, and build verification.
- Kept subcommand implementations in `cli/`, moved shared CLI wiring to `lib/`, adopted prefixed SDK logging and error formatting with debug lifecycle and watch events, and pinned the repository Node.js runtime.
- Added an installable OpenClaw plugin and explicit unfinished-command failures.
- Added pull-request, packed-release, and trusted npm publishing workflows.
