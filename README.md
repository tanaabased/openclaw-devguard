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

In terminal 1, initialize the OpenClaw plugin you want to develop and start its supervised Gateway:

`init` creates or reuses the project-owned `devguard.json`. Agent selections and OAuth consent remain machine-local. Model configuration and portable stored authentication are imported by default, while environment-backed credentials are inherited without being copied; model and authentication transfer can be skipped with `--no-model-profile`.

```sh
cd /path/to/my-openclaw-plugin

# replace my-agent with an agent configured in your normal openclaw profile.
openclaw devguard init . --agent my-agent

# before starting the gateway, add DEVGUARD_EXAMPLE to
# logging.environmentValueAllowlist in the generated devguard.json.

# confirm one build, gateway startup, and live policy hook, then stop.
openclaw devguard run --once

# start the watched development gateway.
OPENCLAW_LOG_LEVEL=debug openclaw devguard run
```

For example, add OpenClaw's `resolve_exec_env` hook inside the same target plugin's `register(api)` implementation. Saving the change causes `run` to rebuild, validate, and replace the Gateway:

```ts
api.on('resolve_exec_env', ({ host }) => {
  api.logger.info(`adding DEVGUARD_EXAMPLE=1 to ${host} exec`);
  return { DEVGUARD_EXAMPLE: '1' };
});
```

In terminal 2, verify the isolated environment, ask the same imported agent to attempt one exec call, and inspect the resulting audit events:

```sh
cd /path/to/my-openclaw-plugin

# check the isolated profile, target build, gateway, and policy hook.
openclaw devguard doctor

# trigger the target plugin's exec-environment hook through the imported agent.
openclaw devguard exec -- agent \
  --agent my-agent \
  --session-key devguard-example \
  --message "Use the exec tool exactly once to run 'printenv DEVGUARD_EXAMPLE', then report the tool result without retrying." \
  --json

# read the attempted and probed tool-call records in human-readable form.
openclaw devguard tail --no-follow

# prove the hook-provided value reached the recorder while the original did not run.
expected_sha256="$(printf '%s' '1' | shasum -a 256 | awk '{print $1}')"
openclaw devguard tail --json --no-follow \
  | grep -F '"event":"tool_call_probe_completed"' \
  | grep -F '"originalCommandExecuted":false' \
  | grep -F '"name":"DEVGUARD_EXAMPLE"' \
  | grep -F "\"sha256\":\"$expected_sha256\""

# stop run in terminal 1 with ctrl-c, then optionally remove managed state.
openclaw devguard restore
```

The hook runs while OpenClaw prepares the exec request, so its diagnostic appears in terminal 1. DevGuard then replaces `printenv` with its recorder; the original command does not execute. The completed probe record proves that the allowlisted hook-provided value reached the recorder without exposing its plaintext value. See [ADVANCED.md](./ADVANCED.md) for agent and model import, configuration, policy modes, logging, `exec` and `shell`, recovery, and the complete CLI contract.

## Caveats

- DevGuard is a development guardrail, **not a sandbox**. Docker sandboxing is disabled, imported workspaces remain ordinary host paths, and target-plugin imports, registration, background work, and direct Node.js access are outside its tool policy.
- `probe` is the default policy mode. Only `exec` currently has a non-mutating probe; other tools—including `filesystem`, `process`, and plugin-defined tools—are denied. Explicit `deny` mode blocks every tool request, while Probe reports the recorder's real result rather than pretending the requested command succeeded.
- Imported `openai/*` models retain their provider, model, and authentication but run through OpenClaw's built-in agent runtime instead of the default Codex app-server runtime. This enables tool-parameter rewriting and exec-environment hooks, but does not reproduce Codex-native tool or thread behavior. Non-OpenAI runtime policy is preserved and may expose different hook capabilities.
- Profile import is intentionally incomplete. DevGuard copies bounded model configuration and portable authentication, references selected agent workspaces, and uses isolated agent and session state without copying source sessions, channels, bindings, or browser state.
- Sensitive-data obfuscation is best effort. Audit logs can retain ordinary prompts, command text, paths, identifiers, and other values that do not look like credentials, so treat them as sensitive.
- `restore` removes only DevGuard-managed isolated state. It cannot reverse changes made directly by target-plugin code and does not remove imported workspaces, target source, or audit logs.
- CI currently exercises macOS 26 and Ubuntu 24.04. Windows is not supported or exercised.

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
