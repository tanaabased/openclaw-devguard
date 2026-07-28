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
5. Block side-effecting tool calls by default.
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

- select or create the OpenClaw `dev` profile
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
- produce a summary of all applied changes

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
- watch source and build output
- debounce rapid filesystem changes
- rebuild when needed
- restart the Gateway after successful builds
- retain and display failed startup output
- verify that the expected plugin build loaded
- enable useful OpenClaw lifecycle diagnostics
- stream correlated DevGuard and OpenClaw logs

Suggested environment flags:

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

- development profile is active
- the normal production profile is not being mutated
- ambient channels are disabled
- sandbox mode is enabled where supported
- workspace access is `none` or explicitly approved
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

DevGuard should register a high-priority `before_tool_call` hook.

Default policy:

| Tool category                          | Default       |
| -------------------------------------- | ------------- |
| Pure inspection or read-only tools     | Configurable  |
| Filesystem mutation                    | Block and log |
| `exec` and process execution           | Block and log |
| Network and external services          | Block and log |
| Browser and computer control           | Block and log |
| Messaging                              | Block and log |
| Cron, Gateway, and node administration | Block and log |
| Unknown plugin tools                   | Block and log |

### Modes

DevGuard should support three explicit modes:

```yaml
mode: deny
mode: approve
mode: observe
```

#### `deny`

Default mode.

- record the attempted call
- redact sensitive values
- block execution
- return a clear policy error

#### `approve`

Optional mode.

- record the attempted call
- require explicit operator approval
- execute only after approval
- record the approval result

This mode may be implemented after the basic v0.1 deny flow if needed.

#### `observe`

Dangerous mode.

- record the attempted call
- permit execution
- display a prominent warning when enabled

This mode must never be the default.

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

Suggested default location:

```text
~/.openclaw-dev/devguard/logs/
```

Example event:

```json
{
  "timestamp": "2026-07-25T17:30:00.000Z",
  "runId": "run_...",
  "toolCallId": "call_...",
  "agentId": "dev",
  "sessionKey": "session_...",
  "toolName": "exec",
  "toolKind": "exec",
  "params": {
    "command": "npm publish"
  },
  "derivedPaths": [],
  "effects": ["process", "network", "external-state"],
  "decision": "blocked",
  "reason": "DevGuard deny mode",
  "environment": {
    "keys": ["PATH", "HOME", "GH_TOKEN"],
    "values": "redacted"
  }
}
```

### Required event types

At minimum:

- tool call attempted
- tool call blocked
- tool call approved
- tool call allowed
- build started
- build succeeded
- build failed
- Gateway started
- Gateway restart requested
- Gateway start failed
- target plugin loaded
- target plugin load failed
- plugin validation failed
- doctor check failed
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
- log values only for an explicit allowlist
- permit hashes or change indicators for selected variables
- record variables injected by DevGuard itself
- record environment variables explicitly included in tool arguments

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

Suggested project configuration file:

```text
devguard.yaml
```

Example:

```yaml
version: 1

plugin:
  id: example-plugin
  path: .
  buildCommand: npm run plugin:build
  validateCommand: npm run plugin:validate
  watch:
    - src
    - openclaw.plugin.json
    - package.json

policy:
  mode: deny
  allowReadOnlyTools: true
  denyUnknownTools: true
  denyElevated: true

sandbox:
  enabled: true
  backend: docker
  scope: session
  workspaceAccess: none
  network: none

logging:
  format: jsonl
  redactEnvironmentValues: true
  environmentValueAllowlist: []

gateway:
  profile: dev
  port: 19001
  disableChannels: true
```

Configuration should use strict schema validation and reject unknown keys by default.

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
→ side-effecting calls are blocked
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

A simple build identifier can be derived from:

- Git commit
- working-tree dirty state
- build timestamp
- source-content hash

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

## v0.1 Implementation Order

### Phase 1: Package and CLI skeleton

- create package
- register `openclaw devguard`
- define configuration schema
- implement development-profile detection
- implement configuration snapshot and restore

### Phase 2: Tool capture

- register high-priority `before_tool_call`
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
- add integration tests

## Acceptance Criteria

v0.1 is complete when all of the following are true:

1. A developer can initialize DevGuard against an external OpenClaw plugin repository with one command.
2. The normal OpenClaw profile and credentials are not used.
3. Ambient messaging channels are not connected.
4. A test agent can attempt an `exec` call without the command executing.
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
