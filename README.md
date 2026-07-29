# OpenClaw DevGuard

<p align="center">
  <img src="./assets/openclaw.png" alt="OpenClaw mascot" width="180" />
</p>

<p align="center">
  <a href="https://github.com/tanaabased/openclaw-devguard/actions/workflows/pr-linter.yml"><img src="https://github.com/tanaabased/openclaw-devguard/actions/workflows/pr-linter.yml/badge.svg" alt="Lint" /></a>
  <a href="https://github.com/tanaabased/openclaw-devguard/actions/workflows/pr-unit-tests.yml"><img src="https://github.com/tanaabased/openclaw-devguard/actions/workflows/pr-unit-tests.yml/badge.svg" alt="Unit tests" /></a>
  <a href="https://github.com/tanaabased/openclaw-devguard/actions/workflows/pr-examples-tests.yml"><img src="https://github.com/tanaabased/openclaw-devguard/actions/workflows/pr-examples-tests.yml/badge.svg" alt="Example tests" /></a>
</p>

OpenClaw DevGuard is a third-party development plugin that builds another OpenClaw plugin in an isolated profile, supervises its Gateway, and blocks and audits agent tool calls.

> [!NOTE]
> Requires OpenClaw 2026.7.1-2 or newer.

> [!WARNING]
> DevGuard is intended for development profiles that run with OpenClaw Docker sandboxing off, and it configures its isolated profile that way. Its OpenClaw exec layer is intentionally permissive so model transport and tool requests reach DevGuard's terminal policy hook. DevGuard protects that tool-call pipeline but does not isolate plugin imports, registration code, background workers, or direct filesystem and network access. Workflows that require OpenClaw's Docker sandbox are not currently supported; use a separate VM or container for untrusted code.

## Overview

DevGuard:

- creates project-specific OpenClaw state outside the normal profile
- links, builds, and watches a target plugin
- validates each successful build before replacement
- restarts its owned Gateway only after a successful build
- verifies the live plugin build and fail-closed deny hook
- records redacted tool-call attempts and blocks every tool
- tails audit events, diagnoses safety drift, and restores isolated state

The [OpenClaw guide](./OPENCLAW.md) covers the complete target-plugin workflow and CLI.

## Quickstart

Install DevGuard from source into the normal OpenClaw profile:

```sh
git clone https://github.com/tanaabased/openclaw-devguard.git
cd openclaw-devguard
bun install
bun run build
openclaw plugins install --link .
openclaw plugins enable openclaw-devguard
```

Then initialize and supervise the plugin you want to develop:

```sh
cd /path/to/openclaw-plugin
openclaw devguard init .
openclaw devguard run
```

`init` applies to the target plugin in the supplied path. By default it imports the active OpenClaw profile's default agent, model configuration, and portable authentication into isolated state. Add other configured agents by ID or opt out of model and credential transfer:

```sh
openclaw devguard init . --agent ops --agent qa
openclaw devguard init . --no-model-profile
```

Running `init` inside this repository dogfoods DevGuard itself. See the [OpenClaw guide](./OPENCLAW.md#import-models-and-agents) for OAuth consent, workspace reuse, and the exact import boundary.

## Usage

Use a bounded run to build the target, start its isolated Gateway, verify the live hook, and exit:

```sh
openclaw devguard run --once
```

Use debug logging while checking the watch loop:

```sh
OPENCLAW_LOG_LEVEL=debug openclaw devguard run
```

Inspect recorded events without following the log, check a live supervised environment, and restore its pre-DevGuard configuration:

```sh
openclaw devguard tail --no-follow
openclaw devguard doctor
openclaw devguard restore
```

Run `doctor` while `run` is supervising the target. Stop supervision before `restore`. See [OPENCLAW.md](./OPENCLAW.md) for configuration, Gateway access, logging, redaction, and the complete CLI contract.

## Verification

A successful run prints the active build ID, confirms the deny hook, and resolves the audit log path:

```text
ready        my-plugin
build        2026-07-28T12:00:00.000Z#1
hook         active
log          /path/to/events.jsonl
```

## Development

```sh
bun install
bun run lint
bun run test
```

See [DEVELOPMENT.md](./DEVELOPMENT.md) for the repository layout, complete validation suite, live development loops, dogfooding, package validation, and CI-first operational scenarios.

## Issues, Questions and Support

Use the [GitHub issue queue](https://github.com/tanaabased/openclaw-devguard/issues) for bugs and feature requests.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for release history and [GitHub releases](https://github.com/tanaabased/openclaw-devguard/releases) for published artifacts.

## Maintainers

- [@pirog](https://github.com/pirog)

## Contributors

<a href="https://github.com/tanaabased/openclaw-devguard/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=tanaabased/openclaw-devguard" alt="OpenClaw DevGuard contributors" />
</a>

Made with [contrib.rocks](https://contrib.rocks).

## License

OpenClaw DevGuard is licensed under the [MIT License](./LICENSE). The OpenClaw mascot is sourced from the MIT-licensed [OpenClaw](https://github.com/openclaw/openclaw) package; this project is not affiliated with the OpenClaw Foundation.
