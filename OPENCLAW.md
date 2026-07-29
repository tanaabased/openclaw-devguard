# OpenClaw

This guide covers using DevGuard to develop another OpenClaw plugin. Start with the [README](./README.md) for installation and the primary path; use [DEVELOPMENT.md](./DEVELOPMENT.md) when changing DevGuard itself.

## Development Model

DevGuard is installed once in the normal profile to expose its CLI. Each target plugin then receives its own configuration and isolated OpenClaw state:

```text
normal profile: DevGuard CLI
        |
target repository: devguard.json and source
        |
native isolated profile: DevGuard + linked target + owned Gateway
        |
DevGuard metadata: marker + token + snapshot + logs
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
- creates a stable native profile under `~/.openclaw-devguard-<plugin>-<hash>/`
- keeps its marker, token, snapshot, and logs under `~/.openclaw-dev/devguard/projects/`
- snapshots pre-existing isolated configuration once
- imports the source default agent, effective model selection, and portable authentication
- resolves additional `--agent` selections from the source profile
- configures a token-authenticated loopback Gateway with channels skipped
- disables OpenClaw Docker sandboxing and elevated tools
- configures exec requests to reach DevGuard's fail-closed policy hook
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

Change `build`, `validate`, `watch`, or `gateway.port` when the inferred defaults do not fit. The schema rejects unknown keys. Use different ports when supervising multiple targets concurrently. Set `DEVGUARD_HOME` to move DevGuard's metadata and logs; native OpenClaw profile locations continue to follow OpenClaw's home-directory convention.

DevGuard explicitly sets `agents.defaults.sandbox.mode` to `off`. It does not require, build, or manage OpenClaw Docker sandbox images, and workflows that require OpenClaw's Docker sandbox are not currently supported. It also sets `tools.exec.mode` to `full` because OpenClaw's Codex app-server model transport cannot run under `deny` or `allowlist`. This does not make DevGuard's policy mode permissive: the exec request reaches the hook pipeline, DevGuard records it, target pre-tool hooks can observe it, and DevGuard's terminal deny hook blocks it. `run` and `doctor` refuse readiness unless that live hook is active. Target plugin code remains developer-controlled and runs in the Gateway process.

## Import Models And Agents

`init` reads from the OpenClaw profile active for that command. It respects normal OpenClaw profile, state, and config-path selection rather than assuming `~/.openclaw`.

The default invocation imports the source default agent with:

- its resolved workspace
- its effective primary model and fallbacks
- referenced model-provider and model-entry configuration
- portable stored API keys and static tokens
- portable OAuth credentials whose provider sets `copyToAgents: true`

Import another configured agent by exact ID with a repeatable option:

```sh
openclaw devguard init . --agent ops --agent qa
```

The imported agent keeps its source workspace by reference but receives a new `agentDir` and empty sessions under the isolated DevGuard state. DevGuard does not import channel bindings, messaging configuration, source sessions, browser state, or source tool and sandbox overrides. A workspace is a default working directory, not a host isolation boundary.

Static credentials with `copyToAgents: false` are not copied. Refreshable OAuth credentials require either provider-declared portability, an interactive confirmation, or an explicit noninteractive selection:

```sh
openclaw devguard init . --copy-oauth
```

Environment credentials such as `OPENAI_API_KEY` remain environment credentials and are inherited by the owned Gateway; DevGuard does not persist them merely to transfer the profile. Secret references remain references rather than being resolved into raw values. Existing credentials in isolated state win on profile-ID collisions.

Skip all model configuration and authentication transfer while still importing selected agent workspaces:

```sh
openclaw devguard init . --agent ops --no-model-profile
```

Imported agent IDs are remembered in DevGuard's local project-state marker for repeated initialization. OAuth permission is not stored as portable project configuration.

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

Use `exec` for one native OpenClaw command against initialized isolated state:

```sh
openclaw devguard exec -- plugins inspect my-plugin --runtime --json
openclaw devguard exec -- agent --session-key devguard-smoke --message "Call an available tool" --json
```

Use `shell` when several native commands belong in the same terminal session:

```sh
openclaw devguard shell
openclaw plugins inspect my-plugin --runtime --json
openclaw agent --session-key devguard-smoke --message "Call an available tool" --json
exit
```

Both commands discover the nearest initialized DevGuard project. `shell` starts `$SHELL -l`, falls back to `/bin/sh`, changes to the target root, inherits the caller's environment and terminal streams, and replaces the OpenClaw profile, state, and config selectors with the isolated values. It does not start the Gateway; keep `run` active in another terminal before invoking Gateway-backed or model-backed commands.

For scripts that need the profile name directly, `profile` writes only that name to standard output and accepts an optional target-plugin path:

```sh
DEVGUARD_PROFILE="$(openclaw devguard profile)"
openclaw --profile "$DEVGUARD_PROFILE" config file
```

The isolated profile imports only the model and agent surface described above; it does not copy general OpenClaw configuration. Ambient channels remain disabled by design.

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

| Command                                                | Behavior                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| `openclaw devguard init [plugin-path] [options]`       | Import a source profile, initialize, build, validate, inspect |
| `openclaw devguard profile [plugin-path]`              | Print the initialized native profile name                     |
| `openclaw devguard exec -- <openclaw-args...>`         | Run one native command against initialized isolated state     |
| `openclaw devguard shell`                              | Open a login shell in initialized isolated state              |
| `openclaw devguard run [--once] [--unsafe-raw-stream]` | Supervise and verify the target                               |
| `openclaw devguard tail [--json] [--no-follow]`        | Follow or read current audit records                          |
| `openclaw devguard doctor`                             | Aggregate configuration, live runtime, and OpenClaw checks    |
| `openclaw devguard restore`                            | Restore or remove managed state while preserving logs         |

`init` options:

| Option               | Behavior                                                      |
| -------------------- | ------------------------------------------------------------- |
| `--agent <id>`       | Import another source agent; repeat for additional agents     |
| `--no-model-profile` | Skip source model configuration and authentication            |
| `--copy-oauth`       | Explicitly copy otherwise non-portable refreshable OAuth data |

Run `doctor` while the supervised Gateway is live. It reports every check rather than stopping at the first failure, including native profile selection, imported agent state, isolation, channel, sandbox, tool-policy, target identity, live build, runtime inspection, and OpenClaw plugin diagnostics.

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

DevGuard blocks OpenClaw tool calls, including read-only, unknown, and plugin-defined tools. It does not isolate imported workspaces, plugin imports, registration, background workers, direct host access, or direct network access. `restore` reverses only DevGuard-managed isolated-profile state; it cannot undo side effects performed directly by plugin code. Use stronger host isolation for untrusted plugin code.
