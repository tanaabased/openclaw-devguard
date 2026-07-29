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

DevGuard gives advanced OpenClaw plugin development its own isolated profile and Gateway, carries over the agents you use, rebuilds as you edit, and blocks and records agent-requested tool calls while you test.

> [!NOTE]
> Requires OpenClaw 2026.7.1-2 or newer. CI covers macOS 26 and Ubuntu 24.04.

> [!WARNING]
> DevGuard runs with OpenClaw Docker sandboxing off and is not a complete safety boundary. It limits mutation by blocking agent-requested tool calls, but plugin code and any direct host access remain outside that protection. Use a VM or container for untrusted code.

## Overview

Use DevGuard to:

- develop one plugin in a dedicated OpenClaw profile and Gateway instead of your normal environment
- carry over the agents you choose, including their workspaces, identities, model settings, and portable authentication
- watch, rebuild, validate, and restart the development Gateway as you edit
- exercise advanced plugin surfaces such as lifecycle hooks, tool hooks, Gateway methods, and plugin-owned CLI commands through real OpenClaw flows
- let earlier hooks observe or modify a tool request before DevGuard blocks its execution
- inspect redacted tool attempts, rebuilds, and Gateway readiness, then restore the isolated environment when you are done

See [ADVANCED.md](./ADVANCED.md) for the complete configuration and CLI references, profile-import details, logging behavior, and security boundary.

## Installation

Install the latest compatible stable release from npm into the normal OpenClaw profile:

```sh
openclaw plugins install npm:@tanaab/openclaw-devguard
openclaw plugins enable openclaw-devguard
```

See [DEVELOPMENT.md](./DEVELOPMENT.md#install-from-source) when installing a linked source checkout.

## Usage

In terminal 1, initialize the OpenClaw plugin you want to develop and start its supervised Gateway:

```sh
cd /path/to/my-openclaw-plugin

# replace my-agent with an agent configured in your normal openclaw profile.
openclaw devguard init . --agent my-agent

# confirm one build, gateway startup, and live deny hook, then stop.
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

In terminal 2, verify the live environment, ask the same imported agent to call exec, and inspect the resulting audit events:

```sh
cd /path/to/my-openclaw-plugin

# check the isolated profile, target build, gateway, and deny hook.
openclaw devguard doctor

# trigger the target plugin's exec-environment hook through the imported agent.
openclaw devguard exec -- agent \
  --agent my-agent \
  --session-key devguard-example \
  --message "Use the exec tool to print the value of DEVGUARD_EXAMPLE." \
  --json

# read the attempted and blocked tool-call records.
openclaw devguard tail --no-follow

# stop run in terminal 1 with ctrl-c, then optionally remove managed state.
openclaw devguard restore
```

The hook runs while OpenClaw prepares the exec request, so its diagnostic appears in terminal 1. DevGuard then records and blocks the tool call; the command itself does not execute. See [ADVANCED.md](./ADVANCED.md) for agent and model import, configuration, logging, `exec` and `shell`, recovery, and the complete CLI contract.

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
