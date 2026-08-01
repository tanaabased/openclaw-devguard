# OpenClaw DevGuard

<p align="center">
  <img src="./assets/devguard-small.png" alt="DevGuard mascot" width="180" />
</p>

<p align="center">
  <a href="https://github.com/tanaabased/openclaw-devguard/releases"><img src="https://img.shields.io/github/v/release/tanaabased/openclaw-devguard" alt="Latest release" /></a>
  <a href="https://github.com/tanaabased/openclaw-devguard/actions/workflows/pr-examples-tests.yml"><img src="https://img.shields.io/github/actions/workflow/status/tanaabased/openclaw-devguard/pr-examples-tests.yml?label=Leia" alt="Leia example tests" /></a>
  <img src="https://img.shields.io/badge/macOS-26-111827" alt="macOS 26" />
  <img src="https://img.shields.io/badge/Ubuntu-24.04-00c88a" alt="Ubuntu 24.04" />
</p>

DevGuard gives advanced OpenClaw plugin development its own isolated profile and Gateway, carries over the agents you use, rebuilds as you edit, and safely probes or blocks agent-requested tool calls while you test.

> [!NOTE]
> Requires OpenClaw 2026.7.1-2 or newer. CI covers macOS 26 and Ubuntu 24.04.

> [!WARNING]
> DevGuard runs with OpenClaw Docker sandboxing off and is not a complete safety boundary. It limits mutation by replacing supported agent-requested tool execution with non-mutating probes and blocking the rest, but plugin code and any direct host access remain outside that protection. Use a VM or container for untrusted code.

## Overview

Use DevGuard to:

- develop one plugin in a dedicated OpenClaw profile and Gateway instead of your normal environment
- carry over the agents you choose, including their workspaces, identities, model settings, and portable authentication
- watch, rebuild, validate, and restart the development Gateway as you edit
- exercise advanced plugin surfaces such as lifecycle hooks, tool hooks, Gateway methods, and plugin-owned CLI commands through real OpenClaw flows
- let earlier hooks observe or modify a tool request before DevGuard probes or blocks its execution
- inspect recorded tool attempts with best-effort sensitive-data obfuscation, follow rebuilds and Gateway readiness, then restore the isolated environment when you are done

See [ADVANCED.md](./ADVANCED.md) for the complete configuration and CLI references, profile-import details, logging behavior, and security boundary.

## Installation

Install the latest compatible stable release from npm into the normal OpenClaw profile:

```sh
openclaw plugins install npm:@tanaab/openclaw-devguard
openclaw plugins enable openclaw-devguard
```

The normal profile exposes the DevGuard CLI but does not activate its tool policy. Capture and policy hooks run only inside a DevGuard-managed development Gateway.

See [DEVELOPMENT.md](./DEVELOPMENT.md#install-from-source) when installing a linked source checkout.

## Usage

Initialize the OpenClaw plugin you want to develop, then verify one complete supervised startup:

`init` creates or reuses the project-owned `devguard.json` and prepares isolated OpenClaw state. It imports the automatic agents, model configuration, and portable stored authentication by default; use `--no-model-profile` when model and authentication transfer are not needed.

```sh
cd /path/to/my-openclaw-plugin
openclaw devguard init .
openclaw devguard run --once
```

`run --once` builds the target, runs any configured validation, starts the isolated Gateway, verifies the target build and DevGuard policy hook, then stops. For active development, keep the watched Gateway running in one terminal:

```sh
OPENCLAW_LOG_LEVEL=debug openclaw devguard run
```

While `run` is active, check the isolated profile, target build, Gateway, and policy hook from another terminal:

```sh
openclaw devguard doctor
```

For a realistic end-to-end exercise with an imported agent, a target `resolve_exec_env` hook, and audit proof that the original command did not run, follow the [Real-World Agent Probe Example](./ADVANCED.md#real-world-agent-probe-example). See [ADVANCED.md](./ADVANCED.md) for agent and model import, configuration, policy modes, logging, `exec` and `shell`, recovery, and the complete CLI contract.

## Caveats

- DevGuard is a development guardrail, **not a sandbox**. Docker sandboxing is disabled, imported workspaces remain ordinary host paths, and target-plugin imports, registration, background work, and direct Node.js access are outside its tool policy.
- `probe` is the default policy mode. Only `exec` currently has a non-mutating probe; other tools—including `filesystem`, `process`, and plugin-defined tools—are denied. Explicit `deny` mode blocks every tool request, while Probe reports the recorder's real result rather than pretending the requested command succeeded.
- Imported `openai/*` models retain their provider, model, and authentication but run through OpenClaw's built-in agent runtime instead of the default Codex app-server runtime. This enables tool-parameter rewriting and exec-environment hooks, but does not reproduce Codex-native tool or thread behavior. Non-OpenAI runtime policy is preserved and may expose different hook capabilities.
- Profile import is intentionally incomplete. DevGuard copies bounded model configuration and portable authentication, references selected agent workspaces, and uses isolated agent and session state without copying source sessions, channels, bindings, or browser state.
- Sensitive-data obfuscation is best effort. Audit logs can retain ordinary prompts, command text, paths, identifiers, and other values that do not look like credentials, so treat them as sensitive.
- `restore` removes only DevGuard-managed isolated state. It cannot reverse changes made directly by target-plugin code and does not remove imported workspaces, target source, or audit logs.
- DevGuard owns ordinary descendants in each launched build, validation, and Gateway process group, not arbitrary host processes. Descendants that deliberately create another session or process group can escape; DevGuard reports cleanup it cannot verify instead of claiming complete resource isolation.
- DevGuard supports macOS and Linux. CI currently exercises macOS 26 and Ubuntu 24.04; Windows and other hosts are not supported.

## Development

See [DEVELOPMENT.md](./DEVELOPMENT.md) for source installation, dogfooding, the complete validation suite, Leia scenarios, and coding standards.

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
