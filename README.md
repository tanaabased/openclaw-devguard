# OpenClaw DevGuard

[![Lint](https://github.com/tanaabased/openclaw-devguard/actions/workflows/pr-linter.yml/badge.svg)](https://github.com/tanaabased/openclaw-devguard/actions/workflows/pr-linter.yml)
[![Unit tests](https://github.com/tanaabased/openclaw-devguard/actions/workflows/pr-unit-tests.yml/badge.svg)](https://github.com/tanaabased/openclaw-devguard/actions/workflows/pr-unit-tests.yml)

OpenClaw DevGuard creates an isolated OpenClaw plugin-development profile, records attempted tool calls, and blocks every tool call by default. It also rebuilds a linked target plugin and restarts its owned Gateway when source files change.

> DevGuard protects OpenClaw's tool-call pipeline. It does not isolate plugin imports, registration code, background workers, direct filesystem access, or direct network access. Use a VM or container when plugin code itself is untrusted.

The complete product intent and threat model live in [SPEC.md](./SPEC.md). That document remains a design target; this README describes implemented behavior only.

## Quickstart

After installing and enabling DevGuard in OpenClaw, initialize it from the plugin you want to develop:

```bash
cd /path/to/openclaw-plugin
openclaw devguard init .
openclaw devguard run
```

`init`:

- creates or validates a strict `devguard.json`
- builds and runtime-inspects the target plugin
- creates project-specific OpenClaw state outside the normal profile
- snapshots existing isolated-profile configuration once
- links and enables the target plugin
- configures token-authenticated loopback access, disabled ambient channels, denied exec, disabled elevated tools, and sandbox workspace access `none`

`run` builds the target, starts the isolated Gateway under Node.js, verifies the live `devguard.status` RPC and expected build ID, then watches the configured paths. It prints the resolved state and log locations rather than requiring you to discover them.

For a bounded installation and Gateway smoke test:

```bash
openclaw devguard run --once
```

Raw OpenClaw stream tracing can contain prompts and secrets and is intentionally opt-in:

```bash
openclaw devguard run --unsafe-raw-stream
```

Operational diagnostics use the `[devguard]` prefix. With debug logging enabled, `init` reports initialization and build activity, while `run` reports watcher setup, each filesystem event, rebuilds, Gateway startup, live verification, and shutdown. That makes an edit to any configured watch path a lightweight smoke test for the watch loop. CLI diagnostics belong to the invoking OpenClaw process; plugin registration diagnostics belong to the Gateway process.

## Deny policy and logs

The runtime registers a high-priority, terminal `before_tool_call` hook. Deny mode blocks all tools, including unknown and plugin-defined tools, and never returns a synthetic success result.

Each attempt appends correlated `tool_call_attempted` and `tool_call_blocked` records to JSONL. Records include the tool name, redacted parameters, derived paths, run and tool-call identifiers when available, Gateway process ID, plugin build ID, and environment metadata.

This audit JSONL is separate from operational logging and remains the canonical record of DevGuard policy decisions.

Environment values are not logged by default. Each variable records its name, presence, and value length. Add exact non-secret names to `devguard.json` when a masked preview would help verify configuration:

```json
{
  "logging": {
    "environmentValueAllowlist": ["NODE_ENV", "MY_PLUGIN_MODE"]
  }
}
```

Allowlisted values use a short head/tail preview such as `de…nt`. Credential-shaped names containing segments such as `TOKEN`, `SECRET`, `PASSWORD`, `AUTH`, `COOKIE`, `SESSION`, `PRIVATE`, `CREDENTIAL`, or `KEY` remain fully redacted even if allowlisted. Tool-argument environments are recorded separately, and logs explicitly do not claim to represent the final complete child-process environment.

If JSONL append fails, the hook reports the logging failure and still blocks the tool call.

## Current CLI

```text
openclaw devguard init [plugin-path]
openclaw devguard run [--once] [--unsafe-raw-stream]
openclaw devguard tail [--json]
openclaw devguard doctor
openclaw devguard restore
```

`init` and `run` are functional. `tail`, `doctor`, and `restore` still fail with an explicit “not implemented” error; their presence does not imply those safeguards are complete.

## Requirements

- The [Bun version](./.bun-version) pinned for installs, builds, and scripts.
- The [Node.js version](./.node-version) pinned for tests and the local OpenClaw runtime.
- OpenClaw 2026.7.1-2 or newer.

The published package accepts every Node.js range supported by its OpenClaw peer dependency. OpenClaw does not support running the Gateway under Bun; `devguard run` launches it through the Node-based `openclaw` CLI.

## Develop DevGuard from source

```bash
bun install
bun run build
openclaw plugins install --link .
openclaw plugins enable openclaw-devguard
```

The repository's lower-level development loop remains available:

```bash
bun run dev:setup
bun run dev
```

That loop uses OpenClaw's built-in `--dev` profile to rebuild DevGuard itself. The product-facing `devguard init` and `devguard run` commands instead create per-target isolated state and perform live build verification.

## Validate

```bash
bun run lint
bun run typecheck
bun run test
bun run build
bun run plugin:check
```

Operational validation is opt-in because it runs OpenClaw commands and starts a Gateway. When explicitly requested, `bun run release:test` packs the npm artifact, installs it into disposable OpenClaw state, initializes an external fixture plugin, starts a token-authenticated isolated Gateway, verifies the live DevGuard build and hook status, and shuts the Gateway down. It does not modify the normal OpenClaw profile.

## Release model

GitHub Releases drive npm publication. Stable releases publish to `latest`; prereleases publish to `edge`. npm trusted publishing handles `npm publish`, while `TANAAB_NPM_DEPLOY` is scoped only to synchronizing the `edge` dist-tag after a stable release. `TANAAB_COAXIUM_INJECTOR` handles release commit and tag synchronization.

## License

OpenClaw DevGuard is licensed under the [MIT License](./LICENSE).
