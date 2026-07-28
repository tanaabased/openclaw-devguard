# OpenClaw DevGuard v0.1

## Purpose

`OpenClaw DevGuard` is a development-focused OpenClaw plugin and CLI workflow for safely testing OpenClaw plugins on a developer workstation.

The primary goal of v0.1 is to let a developer observe what an agent attempts to do without allowing agent-initiated tool calls to mutate the workstation or external systems.

> Working name: `@tanaab/openclaw-devguard`

## Problem

Developing OpenClaw plugins locally provides a much faster feedback loop than developing on a remote Agent Box, but it introduces several risks and workflow problems:

- Agent tool calls may modify the developer's filesystem.
- `exec` calls may run arbitrary commands.
- Network, messaging, browser, cron, and external-service tools may cause real side effects.
- A normal OpenClaw workspace is not a security boundary.
- OpenClaw does not currently provide a universal dry-run mode that replaces every tool result with a simulated success.
- External plugin development generally requires repeated builds, Gateway restarts, runtime inspection, and log monitoring.
- Existing OpenClaw audit logs intentionally omit the tool arguments and outputs needed for development debugging.
- Raw trace logs may expose prompts, credentials, tokens, and other sensitive data.

## v0.1 Product Definition

DevGuard v0.1 will provide a reproducible, isolated, fail-closed OpenClaw plugin development environment.

It will:

1. Configure and use an isolated OpenClaw development profile.
2. Link and enable a local plugin under development.
3. Intercept agent tool calls before execution.
4. Log attempted tool calls in a development-focused format.
5. Block every tool call by default.
6. Automatically rebuild and restart the development Gateway when plugin code changes.
7. Aggregate plugin validation, runtime, lifecycle, and policy diagnostics.
8. Restore the development profile to its previous state.

DevGuard v0.1 is a **capture-and-deny system**, not a true simulation engine.

## Key Safety Model

### What DevGuard protects

DevGuard protects operations that pass through OpenClaw's normal tool-call execution pipeline.

Examples:

- `exec`
- `process`
- filesystem writes and edits
- browser or computer-control tools
- network and external-service tools
- messaging tools
- cron and Gateway administration tools
- plugin-defined tools registered with OpenClaw

### What DevGuard does not protect

DevGuard cannot fully isolate code executed directly by the plugin under development.

It does not necessarily prevent side effects caused by:

- module import or top-level initialization
- the plugin's `register()` implementation
- `gateway_start` hooks
- background timers or workers
- direct Node.js or Bun filesystem calls
- direct HTTP requests
- directly spawned subprocesses
- bugs in OpenClaw itself

The documentation must state clearly:

> DevGuard provides tool-pipeline guardrails, not complete host isolation.

Complete isolation would require running the entire OpenClaw Gateway inside a container, VM, or separate operating-system account. That is outside the v0.1 scope.

## Package Shape

The initial package should contain both:

- an OpenClaw runtime plugin
- an OpenClaw CLI command group

Proposed command namespace:

```bash
openclaw devguard ...
```

The plugin handles tool interception and logging.

The CLI handles development-profile setup, plugin linking, builds, Gateway lifecycle, diagnostics, and configuration restoration.

## Core Commands

### `openclaw devguard init`

Initializes DevGuard for a local plugin repository.

Example:

```bash
openclaw devguard init ./path/to/plugin
```

Responsibilities:

- select or create stable project-specific OpenClaw state
- ensure state is separate from the normal OpenClaw profile
- snapshot the existing development-profile configuration
- disable ambient channels
- link the local plugin
- enable the local plugin
- enable the DevGuard plugin
- configure fail-closed tool policy
- enable OpenClaw sandboxing where available
- default workspace access to `none`
- disable elevated execution
- validate the target plugin
- inspect the target plugin's runtime registration
- produce a concise summary of the resolved target, state, log, and next action

The command must be idempotent.

### `openclaw devguard run`

Runs the development environment.

Example:

```bash
openclaw devguard run
```

Responsibilities:

- run the target plugin's configured build command
- start the isolated OpenClaw development Gateway
- watch configured source and metadata paths
- debounce rapid filesystem changes
- rebuild when needed
- restart the Gateway after successful builds
- retain and display failed startup output
- verify that the expected plugin build loaded
- enable useful OpenClaw lifecycle diagnostics
- write correlated DevGuard lifecycle records alongside tool-call audit records

Runtime environment flags:

```bash
OPENCLAW_PLUGIN_LIFECYCLE_TRACE=1
OPENCLAW_DIAGNOSTICS=plugin.load-profile
OPENCLAW_SKIP_CHANNELS=1
```

Raw prompt and tool-stream tracing must remain opt-in.

Example:

```bash
openclaw devguard run --unsafe-raw-stream
```

### `openclaw devguard tail`

Displays attempted tool calls and relevant runtime events.

Example:

```bash
openclaw devguard tail
```

Supported output modes:

```bash
openclaw devguard tail
openclaw devguard tail --json
openclaw devguard tail --no-follow
openclaw devguard tail --json --no-follow
```

The default output should be concise and human-readable.

The JSON mode should emit the underlying JSONL records.

### `openclaw devguard doctor`

Checks whether the environment is actually safe and running the expected code.

Example:

```bash
openclaw devguard doctor
```

Checks should include:

- the expected project-specific isolated state is active
- the normal production profile is not being mutated
- ambient channels are disabled
- sandbox mode is enabled where supported
- workspace access is `none`
- elevated tools are disabled
- unknown tools are denied
- DevGuard is loaded
- the target plugin is linked and enabled
- the target plugin ID matches its manifest
- the manifest and exported entry agree
- the target plugin registered synchronously where required
- the currently running Gateway loaded the newest successful build
- no stale build output is active
- plugin runtime inspection succeeds
- OpenClaw plugin doctor succeeds

### `openclaw devguard restore`

Restores the development profile to its state before DevGuard initialization.

Example:

```bash
openclaw devguard restore
```

It must:

- restore the saved development-profile configuration
- remove DevGuard-specific temporary state
- avoid changing the user's normal OpenClaw profile
- preserve logs unless explicitly asked to delete them

## Tool Policy

DevGuard should register a high-priority non-terminal `before_tool_call` capture hook and a
low-priority terminal deny hook so target-plugin pre-execution hooks can run between them.

Default policy:

| Tool category                          | v0.1 default  |
| -------------------------------------- | ------------- |
| Pure inspection or read-only tools     | Block and log |
| Filesystem mutation                    | Block and log |
| `exec` and process execution           | Block and log |
| Network and external services          | Block and log |
| Browser and computer control           | Block and log |
| Messaging                              | Block and log |
| Cron, Gateway, and node administration | Block and log |
| Unknown plugin tools                   | Block and log |

### Modes

DevGuard v0.1 supports one explicit mode:

```text
deny
```

#### `deny`

Default mode.

- record the attempted call
- redact sensitive values
- block execution
- return a clear policy error

Approval and observe modes remain possible future work. They are intentionally absent from the v0.1 configuration so an unknown or malformed mode cannot introduce a permissive fallback.

## Important Limitation: No Synthetic Tool Success

The normal OpenClaw `before_tool_call` hook can inspect, rewrite, approve, or block a call, but it cannot return an arbitrary synthetic successful tool result.

Therefore, v0.1 cannot transparently make the model believe that a blocked operation succeeded.

Example behavior:

```text
Agent requests exec
→ DevGuard records the command
→ DevGuard blocks the call
→ Agent receives a policy error
```

Not:

```text
Agent requests exec
→ DevGuard records the command
→ DevGuard returns a fake successful result
→ Agent continues as though the command ran
```

A true simulation mode requires an upstream OpenClaw execution seam that supports request-scoped synthetic tool results.

## Logging

DevGuard should write append-only JSONL development logs.

Default project-specific location:

```text
~/.openclaw-dev/devguard/projects/<plugin-and-project-id>/logs/events.jsonl
```

An attempted-call record carries parameters, effects, and environment summaries. A paired blocked-call record carries the terminal decision and reason:

```json
{
  "event": "tool_call_attempted",
  "timestamp": "2026-07-25T17:30:00.000Z",
  "runId": "run_...",
  "toolCallId": "call_...",
  "agentId": "dev",
  "sessionKey": "session_...",
  "pluginId": "example-plugin",
  "pluginBuildId": "2026-07-25T17:29:58.000Z#1",
  "gatewayProcessId": 12345,
  "toolName": "exec",
  "toolKind": "exec",
  "params": {
    "command": "npm publish"
  },
  "derivedPaths": [],
  "effects": ["process", "network", "external-state"],
  "environment": {
    "gatewayProcess": [
      { "name": "PATH", "present": true, "length": 120 },
      { "name": "GH_TOKEN", "present": true, "length": 20, "redacted": true }
    ],
    "toolArguments": [],
    "devguardInjectedNames": ["DEVGUARD_BUILD_ID", "DEVGUARD_LOG_PATH"],
    "finalToolProcessEnvironmentComplete": false
  }
}
```

### Required event types

At minimum:

- tool call attempted
- tool call blocked
- build started
- build succeeded
- build failed
- plugin validation started
- plugin validation succeeded
- plugin validation failed
- Gateway started
- Gateway restart requested
- Gateway start failed
- Gateway exited unexpectedly
- target plugin loaded
- target plugin load failed
- doctor check failed
- doctor check succeeded
- configuration restored

### Correlation fields

Where available, include:

- timestamp
- run ID
- tool-call ID
- agent ID
- session key
- plugin ID
- plugin build identifier
- Gateway process identifier
- decision
- policy reason

## Environment Variable Handling

DevGuard must not log the complete environment by default.

That would create an unnecessary secret-exposure risk.

Default behavior:

- log environment-variable names only
- redact values
- log masked previews only for an explicit allowlist
- record the names of variables injected by DevGuard itself
- summarize environment variables explicitly included in tool arguments separately

Automatically redact names matching patterns such as:

```text
TOKEN
SECRET
PASSWORD
AUTH
COOKIE
SESSION
PRIVATE
CREDENTIAL
KEY
```

The tool hook may not have access to the final complete environment inherited by the eventual process. The logs must not imply otherwise.

## Configuration

Project configuration file:

```text
devguard.json
```

Example:

```json
{
  "version": 1,
  "plugin": {
    "id": "example-plugin",
    "build": {
      "command": "npm",
      "args": ["run", "plugin:build"]
    },
    "validate": {
      "command": "npm",
      "args": ["run", "plugin:validate"]
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

Configuration uses strict schema validation and rejects unknown keys by default. The deny policy, disabled channels, sandbox mode, workspace denial, and elevated-tool denial are v0.1 safety invariants rather than user-configurable escape hatches.

## Development Loop

Expected user workflow:

```bash
cd my-openclaw-plugin

openclaw devguard init .
openclaw devguard run
```

Then, in another terminal:

```bash
openclaw devguard tail
```

During development:

```text
edit plugin source
→ DevGuard detects change
→ target plugin builds
→ target plugin validates
→ development Gateway restarts
→ runtime registration is checked
→ developer sends a test request
→ attempted tool calls are logged
→ all tool calls are blocked
```

When finished:

```bash
openclaw devguard restore
```

## Build and Restart Behavior

The watcher should:

- watch explicit configured paths
- ignore dependency, output, log, and state directories
- debounce changes
- avoid overlapping builds
- terminate stale build processes
- restart only after a successful build
- preserve the last working Gateway when a new build fails where practical
- clearly distinguish build failure from Gateway failure
- verify the active plugin build after restart

A v0.1 build identifier combines a build-success timestamp with a monotonic sequence number for the active supervision run. It must change before each Gateway replacement and appear in both lifecycle events and the live DevGuard status response.

## Diagnostics Aggregation

DevGuard should wrap or aggregate existing OpenClaw diagnostics rather than reimplement them.

Relevant checks may call or consume:

```bash
openclaw plugins inspect <plugin-id> --runtime --json
openclaw plugins doctor
```

It should also enable plugin lifecycle tracing and plugin load profiling while running.

The output should clearly separate:

- target plugin build errors
- manifest errors
- plugin registration errors
- Gateway startup errors
- DevGuard policy decisions
- OpenClaw sandbox failures

## Fail-Closed Requirements

The environment must fail closed.

Examples:

- If DevGuard fails to register its hook, startup should fail.
- If the target plugin registers an unknown tool, it should be denied by default.
- If sandbox configuration cannot be applied, `doctor` should fail prominently.
- If the wrong OpenClaw profile is active, `run` should refuse to proceed unless explicitly overridden.
- If configuration parsing fails, no permissive defaults should be assumed.
- If redaction fails, the affected value should be omitted rather than logged.

## Non-Goals for v0.1

Do not include these in the initial release:

- complete host isolation
- container orchestration for the entire Gateway
- a web dashboard
- synthetic successful tool results
- full tool-result fixture playback
- deterministic replay of complete agent runs
- automatic capture of every environment-variable value
- production security policy management
- remote Agent Box provisioning
- multi-user or multi-tenant policy management
- database-backed centralized telemetry
- automatic upstream OpenClaw patching

## Future Work

### True simulation mode

Add support when OpenClaw provides a request-scoped interception point capable of returning synthetic tool results.

Possible future command:

```bash
openclaw devguard run --simulate
```

### Full-Gateway container mode

Run the complete development Gateway in an isolated container with:

- ephemeral OpenClaw state
- plugin source mounted read-only
- dedicated writable build and state volumes
- no host home-directory mount
- no Docker socket
- disabled network by default
- only the development Gateway port exposed

Possible future command:

```bash
openclaw devguard run --secure
```

### Tool fixtures and replay

Allow developers to define deterministic fake tool results and replay previously captured calls.

### Interactive approval UI

Provide a terminal or browser approval surface for `approve` mode.

### Permissive policy modes

Consider explicit `approve` and dangerous `observe` modes only after their operator UX and fail-closed configuration boundaries are designed. Neither mode may become an implicit fallback or the default.

## v0.1 Implementation Order

### Phase 1: Package and CLI skeleton

- create package
- register `openclaw devguard`
- define configuration schema
- implement stable project-specific state resolution
- implement configuration snapshot and restore

### Phase 2: Tool capture

- register high-priority capture and low-priority deny `before_tool_call` hooks
- classify tool effects
- implement deny policy
- implement unknown-tool denial
- implement redaction
- write JSONL events

### Phase 3: Development runner

- link and enable target plugin
- run build and validation commands
- start the development Gateway
- implement file watching
- implement controlled restart
- verify loaded build

### Phase 4: Diagnostics

- implement `tail`
- implement `doctor`
- aggregate OpenClaw plugin inspection
- enable lifecycle tracing
- improve startup and failure reporting

### Phase 5: Hardening

- add fail-closed startup checks
- test restoration after crashes
- test redaction
- test stale-build detection
- document security boundaries
- add CI-first Leia integration tests as entries in the existing example workflow matrix

## Acceptance Criteria

v0.1 is complete when all of the following are true:

1. A developer can initialize DevGuard against an external OpenClaw plugin repository with one command.
2. The normal OpenClaw profile and credentials are not used.
3. Ambient messaging channels are not connected.
4. A deterministic OpenClaw tool-pipeline probe with agent and run context can attempt an `exec` call without the command executing.
5. The attempted command appears in the DevGuard log.
6. Filesystem mutation attempts are blocked and recorded.
7. Unknown tools are blocked by default.
8. Sensitive environment values are redacted.
9. Editing the target plugin triggers a build and controlled Gateway restart.
10. The developer can determine which plugin build is currently loaded.
11. Plugin validation and runtime registration failures are clearly reported.
12. `doctor` detects unsafe or incorrect configuration.
13. `restore` returns the development profile to its previous configuration.
14. Documentation clearly explains that plugin code itself still runs on the host.

## Product Positioning

DevGuard should be positioned as:

> A reproducible, inspectable, fail-closed development environment for OpenClaw plugins.

It is not merely another production approval or policy plugin.

Its main value is combining:

- isolated development-profile management
- local plugin linking
- automatic build and Gateway restart
- tool-call capture
- fail-closed blocking
- safe redaction
- correlated logs
- runtime diagnostics
- reversible configuration
