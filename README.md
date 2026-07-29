# OpenClaw DevGuard

<p align="center">
  <img src="./assets/devguard-small.png" alt="DevGuard mascot" width="180" />
</p>

<p align="center">
  <a href="https://github.com/tanaabased/openclaw-devguard/releases"><img src="https://img.shields.io/github/v/release/tanaabased/openclaw-devguard?include_prereleases&sort=semver" alt="Latest release" /></a>
  <a href="https://github.com/tanaabased/openclaw-devguard/actions/workflows/pr-examples-tests.yml"><img src="https://img.shields.io/github/actions/workflow/status/tanaabased/openclaw-devguard/pr-examples-tests.yml?label=Leia" alt="Leia example tests" /></a>
  <img src="https://img.shields.io/badge/macOS-26%2B-111827" alt="macOS 26+" />
  <img src="https://img.shields.io/badge/Ubuntu-24.04-00c88a" alt="Ubuntu 24.04" />
</p>

OpenClaw DevGuard is a third-party development plugin that builds another OpenClaw plugin in an isolated profile, supervises its Gateway, and blocks and audits agent tool calls.

> [!NOTE]
> Requires OpenClaw 2026.7.1-2 or newer. CI covers macOS 26 and Ubuntu 24.04.

> [!WARNING]
> DevGuard is intended for development profiles that run with OpenClaw Docker sandboxing off, and it configures its isolated profile that way. Its OpenClaw exec layer is intentionally permissive so model transport and tool requests reach DevGuard's terminal policy hook. DevGuard protects that tool-call pipeline but does not isolate plugin imports, registration code, background workers, or direct filesystem and network access. Workflows that require OpenClaw's Docker sandbox are not currently supported; use a separate VM or container for untrusted code.

## Overview

DevGuard:

- creates a stable project-specific native OpenClaw profile
- imports selected agents, model configuration, and portable authentication
- links, builds, and watches a target plugin
- validates each successful build before replacement
- restarts its owned Gateway only after a successful build
- verifies the live plugin build and fail-closed deny hook
- records redacted tool-call attempts and blocks every tool
- tails audit events, diagnoses safety drift, and restores isolated state

The normal OpenClaw profile exposes the DevGuard CLI. Each initialized target receives its own configuration, native profile, supervised Gateway, and local DevGuard state:

```text
normal OpenClaw profile: DevGuard CLI
             |
target repository: devguard.json and plugin source
             |
isolated OpenClaw profile: DevGuard + linked target + owned Gateway
             |
local DevGuard state: marker + token + snapshot + logs
```

See [ADVANCED.md](./ADVANCED.md) for the complete configuration and CLI references, profile-import details, logging behavior, and security boundary.

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

Initialize the plugin you want to develop from its repository:

```sh
cd /path/to/openclaw-plugin
openclaw devguard init .
openclaw devguard run
```

`init` creates `devguard.json`, builds and validates the target, and prepares its isolated OpenClaw profile. By default, it imports `main`, the source profile's configured default agent when different, their workspaces and identities, effective model configuration, and portable authentication.

Import other configured agents by exact ID or skip model and authentication transfer:

```sh
openclaw devguard init . --agent ops --agent qa
openclaw devguard init . --no-model-profile
```

Running `init` inside this repository is the supported dogfooding path and makes DevGuard both the guard and the target.

## Use The Isolated Gateway

Keep `run` active while testing Gateway-backed or model-backed OpenClaw commands. In another terminal, use `exec` for one native command:

```sh
cd /path/to/openclaw-plugin
openclaw devguard exec -- plugins inspect my-plugin --runtime --json
openclaw devguard exec -- agent --session-key devguard-smoke --message "Call an available tool" --json
```

Use `shell` when several commands belong in one session:

```sh
openclaw devguard shell
openclaw plugins inspect my-plugin --runtime --json
openclaw agent --session-key devguard-smoke --message "Call an available tool" --json
exit
```

Both commands inherit the caller's environment, select the initialized isolated profile, disable ambient channels, and run from the target root. They do not start the Gateway themselves.

For a bounded build and readiness check that stops the Gateway before returning:

```sh
openclaw devguard run --once
```

## Inspect And Restore

Follow concise audit output, emit raw JSONL, or read the current complete records without following:

```sh
openclaw devguard tail
openclaw devguard tail --json
openclaw devguard tail --json --no-follow
```

Run `doctor` while `run` is supervising the target. It checks the isolated profile, imported agents, live target build, deny hook, Gateway policy, and OpenClaw plugin diagnostics:

```sh
openclaw devguard doctor
```

Stop supervision before restoring. `restore` removes DevGuard-managed isolated state, reinstates a saved isolated configuration when one existed, and preserves audit logs:

```sh
openclaw devguard restore
```

## Configuration

`init` generates a strict `devguard.json` in the target root. The most commonly edited values are the build and validation commands, watched paths, environment-value preview allowlist, and Gateway port:

```json
{
  "version": 1,
  "plugin": {
    "id": "my-plugin",
    "build": {
      "command": "bun",
      "args": ["run", "build"]
    },
    "validate": {
      "command": "bun",
      "args": ["run", "plugin:check"]
    },
    "watch": ["src", "openclaw.plugin.json", "package.json"]
  },
  "logging": {
    "environmentValueAllowlist": []
  },
  "gateway": {
    "port": 19001
  }
}
```

Use a different port for each concurrently supervised target. See the [configuration reference](./ADVANCED.md#configuration-reference) for every field, inferred default, validation rule, and path convention.

## Verification

A successful run prints the active profile and build, confirms the deny hook, and resolves the audit log path:

```text
ready        my-plugin
profile      devguard-my-plugin-a1b2c3d4e5f6
build        2026-07-28T12:00:00.000Z#1
hook         active
log          /path/to/events.jsonl
```

Enable OpenClaw debug logging when inspecting initialization, builds, Gateway startup, runtime loading, verification, and shutdown:

```sh
OPENCLAW_LOG_LEVEL=debug openclaw devguard run
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
