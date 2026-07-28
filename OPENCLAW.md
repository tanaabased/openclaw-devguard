# OpenClaw

This guide covers using DevGuard to develop another OpenClaw plugin. Start with the [README](./README.md) for installation and the primary path; use [DEVELOPMENT.md](./DEVELOPMENT.md) when changing DevGuard itself.

## Development Model

DevGuard is installed once in the normal profile to expose its CLI. Each target plugin then receives its own configuration and isolated OpenClaw state:

```text
normal profile: DevGuard CLI
        |
target repository: devguard.json and source
        |
isolated profile: DevGuard + linked target + owned Gateway + logs
```

Initialize the target repository, not the DevGuard repository:

```sh
cd /path/to/target-plugin
openclaw devguard init .
openclaw devguard run
```

Running those commands from the DevGuard repository is the supported dogfooding case.

## Initialize A Target

The target must contain `package.json`, `openclaw.plugin.json`, and a `build` or `plugin:build` package script. When present, `plugin:check`, `plugin:validate`, or `validate` becomes the post-build validation command. `init` then:

- creates or validates `devguard.json`
- creates stable project-specific state under `~/.openclaw-dev/devguard/projects/`
- snapshots pre-existing isolated configuration once
- configures a token-authenticated loopback Gateway with channels skipped
- denies exec and elevated tools and removes sandbox workspace access
- builds the target
- runs the inferred validation command
- installs and enables DevGuard and the linked target in the isolated profile
- runtime-inspects the target
- runs OpenClaw plugin diagnostics

The generated configuration is deliberately strict:

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
    "watch": ["src", "index.ts", "openclaw.plugin.json", "package.json"]
  },
  "logging": {
    "environmentValueAllowlist": []
  },
  "gateway": {
    "port": 19001
  }
}
```

Change `build`, `validate`, `watch`, or `gateway.port` when the inferred defaults do not fit. The schema rejects unknown keys. Use different ports when supervising multiple targets concurrently. Set `DEVGUARD_HOME` to move the parent directory for project state.

## Run The Target

```sh
openclaw devguard run
```

`run` builds and validates the target, starts the isolated Gateway through the Node-based `openclaw` CLI, verifies the expected build ID and fail-closed deny status, and watches every configured path. Changes are debounced; a successful validated build replaces the Gateway, while a failed build or validation leaves the last working Gateway running.

Common modes:

| Command                                     | Behavior                                    |
| ------------------------------------------- | ------------------------------------------- |
| `openclaw devguard run`                     | Supervise until interrupted                 |
| `openclaw devguard run --once`              | Build, verify, stop, and exit               |
| `openclaw devguard run --unsafe-raw-stream` | Also record OpenClaw's sensitive raw stream |

Raw streams may contain prompts and secrets. Use that option only for deliberate local debugging.

## Use The Isolated Gateway

`init` prints the resolved state directory. Point another terminal at it when inspecting or exercising the target:

```sh
export OPENCLAW_STATE_DIR="/path/printed/by/devguard/state"
openclaw plugins inspect my-plugin --runtime --json
openclaw agent --session-key devguard-smoke --message "Call an available tool" --json
```

The isolated profile does not copy model credentials or general configuration from the normal profile. Configure a model or provide supported provider credentials before expecting an agent turn to run. Ambient channels remain disabled by design.

## Logging And Deny Policy

Diagnostic messages use the OpenClaw plugin logger with a `[devguard]` prefix. Enable debug output to observe initialization, watch events, builds, Gateway startup, runtime loading, verification, and shutdown:

```sh
OPENCLAW_LOG_LEVEL=debug openclaw devguard run
```

The audit JSONL path is printed by `init` and `run`. Every attempted tool call produces correlated `tool_call_attempted` and `tool_call_blocked` records with redacted parameters, derived paths, identifiers, build metadata, and environment summaries.

Environment values are omitted by default. Exact non-secret names can receive a short masked preview:

```json
{
  "logging": {
    "environmentValueAllowlist": ["NODE_ENV", "MY_PLUGIN_MODE"]
  }
}
```

Credential-shaped names remain fully redacted even when allowlisted. If audit logging fails, the hook reports the error and still blocks the tool call.

Use `tail` for concise lowercase output or raw JSONL suitable for another process:

```sh
openclaw devguard tail
openclaw devguard tail --json
openclaw devguard tail --json --no-follow
```

`--no-follow` reads the current complete records and exits. JSON mode writes only the underlying JSONL records to standard output; diagnostics remain on standard error.

## CLI Reference

| Command                                                | Behavior                                                   |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| `openclaw devguard init [plugin-path]`                 | Initialize isolated state, build, validate, and inspect    |
| `openclaw devguard run [--once] [--unsafe-raw-stream]` | Supervise and verify the target                            |
| `openclaw devguard tail [--json] [--no-follow]`        | Follow or read current audit records                       |
| `openclaw devguard doctor`                             | Aggregate configuration, live runtime, and OpenClaw checks |
| `openclaw devguard restore`                            | Restore or remove managed state while preserving logs      |

Run `doctor` while the supervised Gateway is live. It reports every check rather than stopping at the first failure, including isolation, channel, sandbox, tool-policy, target identity, live build, runtime inspection, and OpenClaw plugin diagnostics.

```sh
openclaw devguard doctor
```

Stop `run` before restoring. `restore` atomically reinstates a saved isolated-profile configuration, removes state generated from an empty profile, preserves logs, and is safe to repeat:

```sh
openclaw devguard restore
```

## Verify The Watch Loop

Start `run` with debug logging, then change any configured watch path in another terminal. A successful cycle reports:

```text
[devguard] watch event ...
[devguard] build succeeded ...
[devguard] initializing plugin runtime ...
[devguard] Gateway verified ...
```

Press `Ctrl-C` to stop the owned Gateway.

## Security Boundary

DevGuard blocks OpenClaw tool calls, including read-only, unknown, and plugin-defined tools. It does not isolate imports, plugin registration, background workers, direct host access, or direct network access. `restore` reverses only DevGuard-managed isolated-profile state; it cannot undo side effects performed directly by plugin code. Use stronger host isolation for untrusted plugin code.
