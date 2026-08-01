# Advanced

This guide contains DevGuard's less common operational details and complete configuration and CLI references. Start with the [README](./README.md) for installation and the primary workflow; use [DEVELOPMENT.md](./DEVELOPMENT.md) when changing DevGuard itself.

## Advanced Usage

### Isolated Development Model

DevGuard is installed once in the normal OpenClaw profile so that `openclaw devguard` is available. Its tool policy remains inactive in a normal Gateway; capture, policy, and status surfaces activate only in a DevGuard-managed development Gateway. Initializing a target creates a stable native OpenClaw profile derived from the target's plugin ID and absolute repository path:

```text
normal OpenClaw profile: DevGuard CLI and source configuration
             |
target repository: devguard.json and plugin source
             |
isolated OpenClaw profile: imported agents + DevGuard + linked target
             |
owned Gateway: build verification + tool-call capture and policy
```

The target repository owns and should normally commit `devguard.json`. DevGuard keeps machine-local state under `~/.openclaw-dev/devguard/projects/` by default, including its initialization marker, Gateway token, optional configuration snapshot, logs, and the private owner marker used while `run` is active. The isolated native profile lives at `~/.openclaw-devguard-<plugin>-<hash>/`. Set `DEVGUARD_HOME` to relocate DevGuard's machine-local metadata and logs; it does not relocate OpenClaw's native profile directory.

DevGuard creates its canonical state, isolated agent, and log directories with owner-only permissions and creates tokens, markers, snapshots, isolated configuration, audit logs, and optional raw streams as owner-readable and owner-writable files. When it encounters an existing owned artifact, it removes group and other access without widening stricter owner permissions. It does not change the target repository, normal OpenClaw state, imported workspaces, or arbitrary parent directories.

The absolute target path participates in the profile name and state key. Two checkouts of the same plugin therefore receive different isolated profiles, while repeated initialization of one checkout reuses the same profile.

Agent selections and OAuth-copy consent are machine-local initialization state, not portable project policy, so they are not written to `devguard.json`. The normal source profile is read but not mutated. Imported workspaces remain references to their existing directories; DevGuard uses isolated agent state without copying source sessions, channel bindings, browser state, or general OpenClaw configuration.

Imported provider, model, and authentication selections remain unchanged. DevGuard does explicitly route imported `openai/*` model entries through OpenClaw's built-in agent runtime inside the isolated profile. OpenAI models otherwise default to the Codex runtime, whose native tool calls cannot accept the parameter rewrite required by DevGuard's non-mutating exec probe. Non-OpenAI runtime policy is preserved.

Initialization always makes `main` the isolated default agent. It also imports the source profile's configured default agent when that is a different ID, plus every agent selected with `--agent`. Configured agent identities are projected into the isolated profile. When an agent has no configured identity but its workspace contains `IDENTITY.md`, DevGuard asks OpenClaw to set that identity only in the isolated profile. The fallback Control UI identity is `DEVGUARD` with the bundled DevGuard avatar, making the isolated Gateway visually distinct.

### Supervision And Safety

`run` first acquires exclusive ownership of the target project and verifies that the configured loopback port is available without signaling its current owner. A second live supervisor is rejected with existing owner context. OpenClaw's public PID and process-start-time-aware file lock handles conservative stale recovery; DevGuard's adjacent private marker makes the active project, profile, port, and run inspectable. Ownership is released after normal or failed shutdown.

After those checks, `run` builds and optionally validates the target before starting its loopback, token-authenticated Gateway. It then verifies that the expected target build and DevGuard policy hook are live. Watched changes trigger another build; the active Gateway is replaced only after the new build and validation succeed. A failed or timed-out replacement leaves the last working Gateway active. An unexpected active Gateway exit fails supervision instead of silently falling back.

Initialization and live supervision launch each bounded build and validation in an owned process group. `run` does the same for its Gateway. DevGuard verifies that the complete group is gone after the leader exits or when work is cancelled. On timeout or shutdown it sends `SIGTERM`, waits `supervision.shutdownGraceSeconds`, sends `SIGKILL` when necessary, and waits the same interval to verify removal. Incomplete cleanup is fatal and reports the phase and PID; live supervision also records the failure and stops rather than allowing overlapping work.

This ownership is deliberately limited to ordinary descendants that remain in the launched process group on supported macOS and Linux hosts. A descendant that deliberately creates a new session or process group can escape that ownership, and DevGuard does not claim CPU, memory, PID, filesystem, or general resource isolation.

DevGuard deliberately configures the isolated profile with:

- `agents.defaults.sandbox.mode` set to `off`
- elevated tools disabled
- `tools.exec.mode` set to `full`
- ambient channels skipped for DevGuard-managed OpenClaw processes
- a loopback Gateway protected by a generated token

The permissive OpenClaw exec setting is transport configuration, not DevGuard policy. It allows model transport and tool requests to reach the plugin hook pipeline. In the default `probe` mode, DevGuard records each attempt, replaces an exec request with its non-mutating recorder, and denies tools without an implemented probe. Target pre-tool and exec-environment hooks still run, while the originally requested command does not. Explicit `deny` mode blocks every tool call. If audit logging fails, the call is blocked.

This is a development guardrail, not arbitrary-code isolation. Target plugin imports, registration code, background workers, and direct Node.js filesystem or network access run in the Gateway process and are outside the tool hook. Imported workspaces are normal host paths. DevGuard does not provide command simulation, synthetic tool success, containers, VMs, or production policy enforcement. Use stronger host isolation for untrusted plugin code.

Audit records are written as JSONL and contain correlated lifecycle and tool-policy events. DevGuard makes a best effort to obfuscate sensitive information, but it cannot identify every secret. Values under credential-shaped keys are replaced, and environment values are omitted unless their exact non-secret names appear in `logging.environmentValueAllowlist`; credential-shaped environment names remain fully redacted even when allowlisted. Ordinary tool arguments, including command text, derived paths, identifiers, and build metadata can remain visible. Treat audit logs as sensitive and avoid placing secrets in ordinary prompts or tool arguments.

`restore` reverses only DevGuard-managed isolated-profile state. It does not change the normal source profile, imported workspaces, target source, audit logs, or side effects performed directly by target plugin code.

### Real-World Agent Probe Example

This example builds on the [README usage flow](./README.md#usage) and exercises DevGuard through a real imported agent. It demonstrates that a target plugin can modify an exec environment through OpenClaw's public `resolve_exec_env` hook while DevGuard replaces the agent's requested command with its non-mutating recorder.

Choose an agent with a working model and authentication in the source OpenClaw profile, then import it into the target's isolated state:

```sh
cd /path/to/my-openclaw-plugin
openclaw devguard init . --agent my-agent
```

Add `DEVGUARD_EXAMPLE` to `logging.environmentValueAllowlist` in the generated `devguard.json`. This permits the completed probe record to contain a hash of the value while keeping its plaintext out of the audit log.

Add the hook inside the target plugin's `register(api)` implementation:

```ts
api.on('resolve_exec_env', ({ host }) => {
  api.logger.info(`adding DEVGUARD_EXAMPLE=1 to ${host} exec`);
  return { DEVGUARD_EXAMPLE: '1' };
});
```

Start the watched development Gateway in terminal 1. Saving later target changes causes `run` to rebuild, validate, and replace the Gateway:

```sh
OPENCLAW_LOG_LEVEL=debug openclaw devguard run
```

In terminal 2, verify the live environment, ask the imported agent to attempt one exec call, and inspect the resulting audit events:

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
```

The hook diagnostic appears in terminal 1 while OpenClaw prepares the exec request. DevGuard then runs its recorder instead of `printenv`; the completed probe record proves that the hook-provided value reached the recorder without exposing the plaintext value or executing the original command.

Stop `run` with Ctrl-C when finished. To remove the managed isolated state while preserving audit logs, run:

```sh
openclaw devguard restore
```

## Configuration Reference

`devguard.json` is DevGuard's sole public project configuration. `openclaw devguard init` creates it in the target root when it does not exist and validates the existing file on later runs. The schema is strict: unknown keys, missing required values, invalid types, and invalid ports fail instead of receiving permissive defaults.

After initialization, `profile`, `exec`, `shell`, `run`, `tail`, `doctor`, and `restore` search the current directory and each parent for the nearest `devguard.json`. This allows those commands to run from a nested target directory. `init [plugin-path]` instead initializes the exact supplied directory, which defaults to the current directory.

### Common Values

| Value       | Convention                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| Commands    | A non-empty executable name or path launched directly from the target root.                                             |
| Arguments   | An ordered JSON array of strings passed to the command without shell interpolation.                                     |
| Watch paths | Files or directories resolved relative to the target root. Every configured path must exist when supervision starts.    |
| Plugin IDs  | Non-empty OpenClaw plugin IDs. Keep the value aligned with `openclaw.plugin.json`.                                      |
| Ports       | Integer TCP ports from `1` through `65535`. Concurrent targets need distinct ports.                                     |
| Seconds     | Positive whole seconds. Build and validation limits accept `1` through `3600`; shutdown grace accepts `1` through `60`. |

A typical generated configuration is:

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
  "policy": {
    "mode": "probe"
  },
  "logging": {
    "environmentValueAllowlist": []
  },
  "gateway": {
    "port": 19001
  },
  "supervision": {
    "buildTimeoutSeconds": 120,
    "validationTimeoutSeconds": 300,
    "shutdownGraceSeconds": 5
  }
}
```

### `version`

| Type    | Required | Default |
| ------- | -------- | ------- |
| integer | yes      | `1`     |

Identifies the `devguard.json` schema. Version `1` is the only accepted value.

### `plugin.id`

| Type   | Required | Default                          |
| ------ | -------- | -------------------------------- |
| string | yes      | `id` from `openclaw.plugin.json` |

Identifies the target plugin that DevGuard installs, enables, inspects, watches, and expects to observe in the live Gateway. `doctor` reports a mismatch between this value and the target manifest.

### `plugin.build.command`

| Type   | Required | Default                                                |
| ------ | -------- | ------------------------------------------------------ |
| string | yes      | package manager from `packageManager`, otherwise `npm` |

Selects the executable used to build the target. DevGuard recognizes `bun`, `npm`, `pnpm`, and `yarn` from the package's `packageManager` field; any other or missing value falls back to `npm`. The command runs from the target root with the caller's environment and inherited terminal output.

### `plugin.build.args`

| Type         | Required | Default                                         |
| ------------ | -------- | ----------------------------------------------- |
| string array | yes      | `["run", "plugin:build"]` or `["run", "build"]` |

Provides the build command arguments. Initialization prefers a `plugin:build` package script and otherwise uses `build`. One of those scripts must exist before DevGuard can create the configuration.

Edit both build fields when the inferred package-manager command does not match the target's actual build entrypoint:

```json
{
  "command": "node",
  "args": ["scripts/build.mjs"]
}
```

### `plugin.validate.command`

| Type   | Required                          | Default                                     |
| ------ | --------------------------------- | ------------------------------------------- |
| string | when `plugin.validate` is present | inferred package manager; otherwise omitted |

Selects an optional post-build validation executable. Initialization creates the `plugin.validate` object only when it finds `plugin:check`, `plugin:validate`, or `validate`, in that preference order. Validation must succeed before DevGuard starts or replaces the Gateway.

### `plugin.validate.args`

| Type         | Required                          | Default                                           |
| ------------ | --------------------------------- | ------------------------------------------------- |
| string array | when `plugin.validate` is present | `["run", "<inferred-script>"]`; otherwise omitted |

Provides the optional validation command arguments. Omit the complete `plugin.validate` object to disable post-build validation; providing only one of its fields is invalid.

### `plugin.watch`

| Type         | Required | Default                                     |
| ------------ | -------- | ------------------------------------------- |
| string array | yes      | existing standard source and metadata paths |

Lists files and directories that trigger a rebuild while `run` is supervising. Initialization includes each existing path from this ordered candidate set:

```text
src
cli
lib
utils
index.ts
index.js
index.mjs
openclaw.plugin.json
package.json
tsconfig.json
```

Paths are resolved from the target root. DevGuard watches file contents and ignores unchanged notifications. A changed build is debounced; if another change arrives during a build, the superseded build is stopped and the latest state is built.

### `policy.mode`

| Type   | Required | Default   |
| ------ | -------- | --------- |
| string | no       | `"probe"` |

Selects how DevGuard handles agent-requested tools after earlier OpenClaw and target-plugin hooks have observed or modified the request. New configurations include this field explicitly; configurations created before the policy field was introduced also default to `probe`.

- `probe` records every attempt. An `exec` request is replaced with DevGuard's fixed non-mutating recorder, so the originally requested command does not run. OpenClaw executes the recorder through the real tool and result lifecycle, including target `resolve_exec_env` behavior and downstream result hooks. Tools without an implemented probe are blocked.
- `deny` records and blocks every tool request. It does not execute the recorder or synthesize a successful tool result.

Both modes fail closed when DevGuard cannot write the required audit record. Only `exec` currently has a probe implementation.

### `logging.environmentValueAllowlist`

| Type         | Required | Default |
| ------------ | -------- | ------- |
| string array | yes      | `[]`    |

Names exact non-secret environment variables whose values may receive a short masked preview in tool-call audit records. By default, DevGuard records environment names and metadata without values:

```json
{
  "logging": {
    "environmentValueAllowlist": ["NODE_ENV", "MY_PLUGIN_MODE"]
  }
}
```

Credential-shaped names remain fully redacted even when listed. This setting affects the DevGuard policy hook started by `run`; it does not expose values in normal CLI status output.

### `gateway.port`

| Type    | Required | Default |
| ------- | -------- | ------- |
| integer | yes      | `19001` |

Sets the loopback port for the target's owned OpenClaw Gateway. DevGuard verifies that the port is available before starting any build, watcher, or Gateway work and reports an existing listener without killing or signaling it. The value is also used for Gateway startup, readiness checks, and `doctor`. Use a unique port for each target that may run concurrently.

### `supervision.buildTimeoutSeconds`

| Type    | Required | Default |
| ------- | -------- | ------- |
| integer | no       | `120`   |

Bounds each build run by `init` or `run`. A timed-out initial build fails the command. A timed-out replacement build is recorded while the last working Gateway remains active, provided DevGuard verifies that the timed-out process group was removed.

### `supervision.validationTimeoutSeconds`

| Type    | Required | Default |
| ------- | -------- | ------- |
| integer | no       | `300`   |

Bounds each configured `plugin.validate` run by `init` or `run`. It has the same initial-failure and replacement-preservation behavior as the build timeout.

### `supervision.shutdownGraceSeconds`

| Type    | Required | Default |
| ------- | -------- | ------- |
| integer | no       | `5`     |

Controls owned-process cleanup. DevGuard waits up to this many seconds after graceful termination, then sends `SIGKILL` when the process group remains and waits up to the same interval to verify removal. This applies to superseded builds, validation, Gateway replacement, command timeout, and final shutdown.

## CLI Reference

All commands are registered beneath `openclaw devguard` by the DevGuard plugin installed in the active OpenClaw profile.

### Common Command Behavior

Except for `init`, commands discover the nearest target by walking upward to `devguard.json`. `profile`, `exec`, `shell`, and `run` require a valid machine-local initialization marker. `doctor` reports marker failures alongside its other checks, `restore` validates a marker when one exists and otherwise reports the target unchanged, and `tail` reads the project log without requiring initialized state. Moving the repository or changing its absolute path changes its derived profile and requires initialization at the new location.

DevGuard owns the OpenClaw selectors used for isolated operations. `exec`, `shell`, `run`, and internal diagnostic commands inherit the caller's environment, then replace `OPENCLAW_PROFILE`, `OPENCLAW_STATE_DIR`, and `OPENCLAW_CONFIG_PATH` with the initialized values and disable ambient channels. Source selectors still matter to `init` because they identify the normal OpenClaw profile from which agents and model settings are imported.

| Environment            | Purpose                                                                           |
| ---------------------- | --------------------------------------------------------------------------------- |
| `DEVGUARD_HOME`        | Relocates machine-local DevGuard markers, tokens, snapshots, and logs.            |
| `OPENCLAW_PROFILE`     | Selects the source OpenClaw profile read by `init`; isolated commands replace it. |
| `OPENCLAW_STATE_DIR`   | Selects source OpenClaw state for `init`; isolated commands replace it.           |
| `OPENCLAW_CONFIG_PATH` | Selects the source OpenClaw config for `init`; isolated commands replace it.      |
| `OPENCLAW_LOG_LEVEL`   | Enables OpenClaw diagnostics such as `debug` output from DevGuard.                |
| `SHELL`                | Selects the login shell launched by `shell`; defaults to `/bin/sh`.               |
| `NO_COLOR`             | Disables DevGuard CLI styling when present.                                       |
| `FORCE_COLOR`          | Forces or disables DevGuard CLI color output.                                     |

Normal status and command output goes to standard output. Diagnostic logging and errors use the injected OpenClaw plugin logger with a `[devguard]` prefix. `exec` and `shell` preserve the child process's exit code; other failures set a nonzero process exit code after reporting the relevant command context.

### `openclaw devguard init`

Creates or validates the target configuration, prepares isolated state, and installs a verified build of the target.

#### Usage

```sh
openclaw devguard init [plugin-path] [options]
```

#### Arguments

**`plugin-path`**

Target plugin directory. Defaults to the current directory. The directory must contain `package.json`, `openclaw.plugin.json`, and either a `plugin:build` or `build` package script.

#### Options

**`--agent <id>`**

Imports another configured source agent by exact ID. Repeat the option for additional agents. Imported agent IDs are remembered in machine-local initialization state for later `init` runs.

**`--reset-agents`**

Forgets every remembered `--agent` selection before applying selections from the current command. Use it alone to return to the automatic agents, or combine it with one or more `--agent` options to replace the remembered selections. The automatic `main` and source default agents are unaffected.

**`--no-model-profile`**

Skips model configuration and authentication transfer. Selected agents, workspace references, and identities are still imported.

**`--copy-oauth`**

Explicitly permits copying refreshable OAuth credentials that the provider has not marked portable. This is required for noninteractive initialization when no other usable provider authentication is available.

#### Behavior

Initialization creates `devguard.json` when missing and reuses a valid existing file. It derives a stable native OpenClaw profile and machine-local state path, snapshots pre-existing isolated configuration once, and refuses a previously unmanaged destination containing state that it cannot safely restore. Its build and optional validation use the configured supervision timeouts and owned-process cleanup contract.

The isolated profile always includes `main` as its default agent. DevGuard also imports a differently configured source default and every remembered `--agent` selection. Later initialization runs preserve those selections and add any new `--agent` values unless `--reset-agents` first clears them. Each imported agent keeps its source workspace by reference, receives a new isolated agent directory, and starts without source sessions. Configured identities are copied; otherwise an available workspace `IDENTITY.md` is applied only to the isolated profile.

Unless `--no-model-profile` is present, DevGuard projects each selected agent's effective primary model, fallbacks, referenced model entries, relevant provider configuration, and usable stored authentication. API keys and static tokens marked non-portable with `copyToAgents: false` are skipped. Provider-portable OAuth credentials are copied; other refreshable OAuth credentials require interactive confirmation or `--copy-oauth`. Existing isolated credentials win on profile-ID collisions.

Environment credentials such as `OPENAI_API_KEY` remain environment credentials. They are inherited by DevGuard-managed processes but are not persisted merely to transfer a profile. Secret references remain references instead of being resolved into raw values.

DevGuard configures a token-authenticated loopback Gateway, `main` as the default agent, the `DEVGUARD` Control UI identity, Docker sandboxing off, elevated tools off, and OpenClaw exec transport on. It then builds and optionally validates the target, installs and enables DevGuard and the linked target in isolated state, performs a runtime inspection, and runs OpenClaw plugin diagnostics.

The command prints the target root, profile, state, audit log, imported agents, model and authentication summary, configuration disposition, and suggested next command.

#### Examples

```sh
# import the source defaults and portable authentication.
openclaw devguard init .

# add two named agents.
openclaw devguard init . --agent ops --agent qa

# forget previous selections and return to the automatic agents.
openclaw devguard init . --reset-agents

# replace previous selections with one named agent.
openclaw devguard init . --reset-agents --agent ops

# keep agent workspaces and identities without model or auth transfer.
openclaw devguard init . --agent ops --no-model-profile

# permit non-portable oauth copying in a noninteractive environment.
openclaw devguard init . --copy-oauth
```

### `openclaw devguard profile`

Prints the initialized native OpenClaw profile name for scripts that need to invoke OpenClaw directly.

#### Usage

```sh
openclaw devguard profile [plugin-path]
```

#### Arguments

**`plugin-path`**

Target directory from which to begin upward project discovery. Defaults to the current directory.

#### Behavior

The command verifies the initialization marker and writes only the profile name plus a newline to standard output. It does not change the caller's environment or start the Gateway.

#### Example

```sh
DEVGUARD_PROFILE="$(openclaw devguard profile)"
openclaw --profile "$DEVGUARD_PROFILE" config file
```

Prefer `exec` for a single native command and `shell` for an interactive sequence because they also select the exact isolated state and config paths.

### `openclaw devguard exec`

Runs one native OpenClaw command against the nearest initialized target.

#### Usage

```sh
openclaw devguard exec -- <openclaw-args...>
```

#### Arguments

**`openclaw-args`**

The OpenClaw subcommand and arguments to execute. Use `--` before them so options are forwarded to OpenClaw rather than parsed as DevGuard options.

#### Behavior

`exec` changes to the discovered target root, inherits the caller's environment and terminal streams, selects the isolated profile, state, and config, disables ambient channels, and runs `openclaw` with the supplied arguments. Its exit status is the native OpenClaw command's exit status.

It does not start a Gateway. Keep `run` active elsewhere before executing Gateway-backed or model-backed commands.

#### Examples

```sh
openclaw devguard exec -- config get ui.assistant.name --json
openclaw devguard exec -- plugins inspect my-plugin --runtime --json
openclaw devguard exec -- agent --session-key devguard-smoke --message "Call an available tool" --json
```

### `openclaw devguard shell`

Starts a login shell already scoped to the nearest initialized target.

#### Usage

```sh
openclaw devguard shell
```

#### Behavior

`shell` launches `$SHELL -l`, falling back to `/bin/sh -l`. The shell starts in the target root, inherits the caller's environment and terminal streams, and receives isolated OpenClaw profile, state, and config selectors with ambient channels disabled. The command returns the shell's exit status.

The shell does not start a Gateway. Keep `run` active in another terminal for Gateway-backed or model-backed commands. Exit the shell normally to return to the source environment.

#### Example

```sh
openclaw devguard shell
openclaw config get ui.assistant.name --json
openclaw plugins inspect my-plugin --runtime --json
exit
```

### `openclaw devguard run`

Builds, verifies, and supervises the nearest initialized target and its owned Gateway.

#### Usage

```sh
openclaw devguard run [options]
```

#### Options

**`--startup-timeout <seconds>`**

Waits the given positive whole number of seconds for the Gateway to load and report the expected target build. Defaults to `60`.

**`--unsafe-raw-stream`**

Enables OpenClaw's raw event stream at the target's machine-local log directory. DevGuard pre-creates the stream as an owner-only file. Raw streams may contain prompts, model content, and secrets; use this only for deliberate local debugging.

**`--once`**

Builds and validates the target, starts and verifies the Gateway and active policy hook, then stops supervision and exits.

#### Behavior

`run` requires initialized state and its generated Gateway token. Before build, watch, or Gateway work, it acquires the target's private supervisor lock and checks the configured loopback port. A live owner or occupied port fails with corrective context; DevGuard never signals an unrelated port owner. A stale lock is recovered only through OpenClaw's PID and process-start-time-aware public lock contract.

After preflight succeeds, `run` builds the target, executes `plugin.validate` when configured, starts OpenClaw Gateway under Node.js, and waits for DevGuard's `devguard.status` method to report the expected profile, state, build ID, policy mode, and active hook.

Without `--once`, it watches every `plugin.watch` path until interrupted. A successful validated build replaces the current Gateway. A failed or timed-out build or validation is recorded and leaves the last working Gateway running after verified process cleanup. An unexpected Gateway error, signal, or exit causes `run` to fail and clean up its watcher and owned process groups. Cleanup that cannot be verified is fatal and reports the remaining PID instead of starting replacement work.

The Gateway inherits the caller's environment, including environment-backed model credentials. DevGuard adds only the isolated OpenClaw selectors and its internal build, audit, target, diagnostics, and channel settings.

#### Examples

```sh
# supervise until interrupted.
openclaw devguard run

# verify one build and stop.
openclaw devguard run --once

# allow extra time on a slow machine.
openclaw devguard run --startup-timeout 90

# observe detailed devguard and openclaw lifecycle diagnostics.
OPENCLAW_LOG_LEVEL=debug openclaw devguard run
```

A ready Gateway reports:

```text
ready        my-plugin
profile      devguard-my-plugin-a1b2c3d4e5f6
build        2026-07-28T12:00:00.000Z#1
hook         active
log          /path/to/events.jsonl
```

### `openclaw devguard tail`

Reads or follows the nearest target's DevGuard audit log.

#### Usage

```sh
openclaw devguard tail [options]
```

#### Options

**`--json`**

Writes the underlying newline-delimited JSON records to standard output without human formatting. Diagnostics remain separate.

**`--no-follow`**

Reads all currently complete records and exits instead of waiting for appended events.

#### Behavior

Human mode renders concise lowercase event labels and relevant details. Malformed records are ignored with a diagnostic warning rather than terminating the stream. Following continues until interrupted with `Ctrl-C` or a termination signal.

#### Examples

```sh
openclaw devguard tail
openclaw devguard tail --no-follow
openclaw devguard tail --json --no-follow
```

### `openclaw devguard doctor`

Aggregates configuration, isolated-state, live runtime, and OpenClaw diagnostic checks for the nearest target.

#### Usage

```sh
openclaw devguard doctor [--fix-permissions] [--json]
```

#### Options

**`--fix-permissions`**

Removes group and other access from existing canonical DevGuard-owned artifacts before evaluating the permission check. Missing optional artifacts are ignored, stricter owner permissions are preserved, and symbolic links or unexpected file types are reported instead of followed.

**`--json`**

Writes one newline-terminated JSON object to standard output with an overall `ok` value, the complete ordered `checks` array, and the `repairedPermissions` paths changed by an explicit repair. Diagnostics remain separate from standard output.

#### Behavior

Run `doctor` while `run` is supervising the target. It checks initialization and profile identity, the matching project supervisor owner, configured port ownership, private permissions on existing canonical artifacts, separation from normal OpenClaw state, imported agents, OpenAI runtime compatibility, loopback token authentication, channels, Docker sandbox mode, elevated and exec transport settings, manifest identity, latest successful build, live Gateway status, active policy hook, runtime plugin inspection, and `openclaw plugins doctor`. When the Gateway is unreachable, the port check distinguishes an available port from an unrelated listener without signaling either. Runtime inspection validates that both DevGuard and the target are loaded through OpenClaw's public inspection contract, that the DevGuard CLI registration remains visible, and that OpenClaw reports no DevGuard compatibility warnings. The live status check also validates the DevGuard-owned response fields before evaluating their values, so changed OpenClaw integration contracts identify the malformed field.

The command prints every check instead of stopping at the first failure. Human mode renders the existing styled status list; JSON mode exposes the same check IDs, labels, results, ordering, and failure details. It records failed or successful doctor events in the audit log and exits nonzero after reporting the complete set when any check fails.

### `openclaw devguard restore`

Restores or removes the nearest target's DevGuard-managed isolated state while preserving its logs.

#### Usage

```sh
openclaw devguard restore
```

#### Behavior

Stop `run` before restoring. DevGuard validates its initialization marker, marks restoration in progress, removes the managed isolated state directory, and atomically reinstates the saved pre-DevGuard OpenClaw configuration when one existed. It then removes the marker, Gateway token, and temporary snapshot while leaving the project log directory intact.

If no active initialization marker exists, the command reports the target as unchanged. Repeating a completed restore is therefore safe. Restoration does not change the source OpenClaw profile, target repository, imported workspace contents, or direct side effects from plugin code.

#### Example

```sh
openclaw devguard restore
```
