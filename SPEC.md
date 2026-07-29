# OpenClaw DevGuard Product Specification

## Purpose

`OpenClaw DevGuard` is a development-focused OpenClaw plugin and CLI workflow for supervising and testing OpenClaw plugins on a developer workstation.

Its primary goal is to let a developer observe and explicitly control what an agent attempts through OpenClaw's tool pipeline while retaining a fast local build, Gateway, diagnostics, and testing workflow.

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

## Product Definition

DevGuard provides a reproducible, isolated-profile OpenClaw plugin development environment.

It will:

1. Configure and use an isolated OpenClaw development profile.
2. Link and enable a local plugin under development.
3. Intercept agent tool calls before execution.
4. Log attempted tool calls in a development-focused format.
5. Block every tool call by default while leaving room for explicit native approval and allow policies.
6. Automatically rebuild and restart the development Gateway when plugin code changes.
7. Aggregate plugin validation, runtime, lifecycle, and policy diagnostics.
8. Restore the development profile to its previous state.

The implemented baseline is a **capture-and-deny system**, not a simulation engine. The path to `1.0.0` may add explicit `approve` and `allow` modes for real OpenClaw tool execution without changing that boundary.

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

Complete isolation would require running the entire OpenClaw Gateway inside a container, VM, or separate operating-system account. That is outside the product scope.

## Package Shape

The package contains both:

- an OpenClaw runtime plugin
- an OpenClaw CLI command group

Proposed command namespace:

```bash
openclaw devguard ...
```

The plugin handles tool interception and logging.

The CLI handles development-profile setup, plugin linking, builds, Gateway lifecycle, diagnostics, and configuration restoration.

## Supported Platforms

DevGuard must publish a truthful platform contract derived from exercised CI and runtime behavior.

- macOS and Linux are the initial supported host platforms.
- Windows is unsupported until process ownership, signal handling, filesystem permissions, path behavior, and operational scenarios are implemented and exercised there.
- Unsupported hosts should fail before mutating project state and report the missing platform contract clearly.
- Documentation and package metadata may not imply support broader than the tested platform matrix.

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

- acquire exclusive ownership of the project-specific supervision state
- refuse to compete with a live DevGuard supervisor for the same project
- preflight the configured Gateway port without terminating an unrelated process
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

In default `deny` mode, checks should include:

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

## CLI Output and Exit Contract

DevGuard commands must be reliable automation boundaries as well as readable interactive commands.

- Exit `0` only after the requested operation succeeds or an active `run` session receives a normal operator shutdown signal.
- Exit nonzero for invalid DevGuard configuration, failed initialization, build or validation failure, unsafe readiness, failed restoration, or unexpected Gateway termination.
- Human command results belong on standard output and diagnostics or errors belong on standard error.
- JSON modes must keep standard output machine-readable and route diagnostics to standard error.
- Do not assign additional stable numeric meanings until distinct exit codes have a demonstrated caller.

## Tool Policy

DevGuard should register a high-priority non-terminal `before_tool_call` capture hook and a
low-priority policy hook so target-plugin pre-execution hooks can run between them. In `deny`
mode, the policy hook should terminally block the call. In `approve` and `allow` modes, it should
apply the corresponding policy without manufacturing a result.

Default policy:

| Tool category                          | Default policy |
| -------------------------------------- | -------------- |
| Pure inspection or read-only tools     | Block and log  |
| Filesystem mutation                    | Block and log  |
| `exec` and process execution           | Block and log  |
| Network and external services          | Block and log  |
| Browser and computer control           | Block and log  |
| Messaging                              | Block and log  |
| Cron, Gateway, and node administration | Block and log  |
| Unknown plugin tools                   | Block and log  |

### Modes

DevGuard's policy vocabulary is `deny`, `approve`, and `allow`. `deny` is the implemented and required default. `approve` and `allow` are path-to-`1.0.0` features and must not be inferred from missing, unknown, or malformed configuration.

#### `deny`

Default mode.

- record the attempted call
- redact sensitive values
- block execution
- return a clear policy error

#### `approve`

Explicit native-approval mode.

```bash
openclaw devguard run --mode approve
```

- record and redact the attempted call before requesting approval
- use OpenClaw's public `before_tool_call.requireApproval` mechanism
- initially offer only `allow-once` and `deny`
- treat timeout, cancellation, missing approval routing, audit failure, and malformed configuration as denial
- record the approval request and resolution
- permit the real tool call after approval while allowing independent OpenClaw policy to deny it
- use OpenClaw approval surfaces rather than a DevGuard-specific terminal or browser UI

#### `allow`

Explicit real-execution mode.

```bash
openclaw devguard run --mode allow
```

- record and redact the attempted call
- permit the real tool call without a DevGuard approval prompt
- retain independent OpenClaw policy, sandbox, and tool behavior
- block rather than execute when required audit logging fails
- require a conspicuous run-scoped selection
- surface the active mode in startup output, live status, logs, and `doctor`
- never become a persisted or implicit fallback

### Shared mode invariants

- `deny` remains the default.
- Unknown or malformed policy configuration resolves to `deny`.
- Every mode uses real OpenClaw tool outcomes; no mode fabricates success.
- `approve` and `allow` may cause real side effects and must say so clearly.
- Mode-specific OpenClaw configuration must be internally consistent. DevGuard may not report that a call is approved or allowed while its own generated profile silently denies the same capability.

## Important Limitation: No Synthetic Tool Success

The normal OpenClaw `before_tool_call` hook can inspect, rewrite, approve, or block a call, but it cannot return an arbitrary synthetic successful tool result.

Therefore, DevGuard cannot transparently make the model believe that a blocked operation succeeded.

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

Synthetic success is outside the product boundary even if OpenClaw later exposes such a seam.

## Logging

DevGuard should write append-only JSONL development logs.

Default project-specific location:

```text
~/.openclaw-dev/devguard/projects/<plugin-and-project-id>/logs/events.jsonl
```

DevGuard-owned state must be private on every supported platform. On POSIX hosts, project state and
log directories should be no broader than `0700`, and Gateway tokens, configuration snapshots,
ownership markers, JSONL audit logs, and unsafe raw streams should be no broader than `0600`.
`doctor` must report unsafe permissions, and DevGuard may repair permissions only on artifacts it
owns.

Active audit logs remain append-only and `restore` preserves them. DevGuard must warn when an audit
log approaches or exceeds a documented size threshold. It must not silently delete or rotate logs;
any future pruning or rotation must be explicit, preserve complete JSONL records, and retain
predictable `tail` behavior.

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

Configuration uses strict schema validation and rejects unknown keys by default. Deny-mode safety settings are invariants rather than user-configurable escape hatches. Future `approve` and `allow` support must define coherent mode-specific OpenClaw settings instead of partially overriding the generated deny profile.

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

During development in the default `deny` mode:

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

A build identifier combines a build-success timestamp with a monotonic sequence number for the active supervision run. It must change before each Gateway replacement and appear in both lifecycle events and the live DevGuard status response.

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

Policy selection and required safety and audit boundaries must fail closed. An explicitly selected
`allow` mode permits execution by design; it must not weaken failure handling for configuration,
redaction, or required audit logging.

Examples:

- If DevGuard fails to register its hook, startup should fail.
- If the target plugin registers an unknown tool, it should be denied by default.
- If sandbox configuration cannot be applied, `doctor` should fail prominently.
- If the wrong OpenClaw profile is active, `run` should refuse to proceed unless explicitly overridden.
- If configuration parsing fails, no permissive defaults should be assumed.
- If redaction fails, the affected value should be omitted rather than logged.

## Product Boundary

DevGuard treats agent-requested tool activity as untrusted and target plugin code as developer-controlled. It owns the local development workflow around public OpenClaw lifecycle, inspection, diagnostic, and tool-policy APIs.

In scope:

- project-specific OpenClaw profile management
- target plugin build, validation, watch, and Gateway supervision
- redacted tool-call and lifecycle auditing
- explicit `deny`, `approve`, and `allow` policy modes for real OpenClaw tool calls
- native OpenClaw approval routing
- runtime capability inspection and boundary warnings
- reversible DevGuard-managed configuration
- local and CI-oriented diagnostic workflows

Out of scope unless the project is explicitly rechartered:

- container, VM, or separate-account orchestration
- arbitrary target-plugin code isolation
- direct Node.js, Bun, filesystem, subprocess, or network API interception
- synthetic tool success, command simulation, fixture playback, or agent-run replay
- a DevGuard-specific approval UI
- production security policy management
- remote Agent Box provisioning
- multi-user or multi-tenant runtime management
- database-backed centralized telemetry
- automatic upstream OpenClaw patching

## Current Baseline

The current baseline establishes the product's core workflow:

- package and `openclaw devguard` CLI registration
- strict project configuration and stable project-specific state
- snapshot and crash-recoverable restoration
- high-priority non-terminal tool capture and low-priority terminal denial
- redaction and append-only correlated JSONL events
- target plugin build, validation, file watching, and controlled Gateway restart
- current-build verification and unexpected Gateway exit handling
- human and JSON `tail` output
- aggregate `doctor` checks
- OpenClaw lifecycle diagnostics
- CI-first Leia operational examples

This section records the intended baseline, not proof that a checkout currently satisfies it. Validation and the changelog remain the implementation evidence.

## Path to 1.0.0

The path to `1.0.0` is prioritized by product value rather than assigned to predetermined minor versions. Re-evaluate ordering when implementation evidence changes, but do not move excluded work into scope solely because an upstream seam or implementation shortcut appears.

### Evaluation rubric

Complexity estimates include implementation, tests, failure behavior, and documentation:

- **S:** one focused surface with limited coordination
- **M:** several coordinated modules or commands
- **L:** cross-cutting policy and operational behavior
- **XL:** new runtime architecture or a separate product boundary

Impact measures expected improvement to the core developer workflow:

- **High:** materially improves safety, trust, or the primary test loop
- **Medium:** meaningfully improves diagnosis or ergonomics
- **Low:** narrow convenience or limited recurring value

Effort-to-impact is qualitative:

- **Excellent:** high leverage and a strong early candidate
- **Good:** worthwhile with bounded design work
- **Fair:** useful, but requires proportionally more coordination or risk management
- **Poor:** weak fit or excessive work for this product

`Required` candidates are part of the proposed `1.0.0` contract. `Candidate` items remain eligible before `1.0.0` but should not delay it without evidence that they close a material workflow gap.

### Ranked feature and improvement backlog

| Rank | Feature or improvement                           | Complexity | Impact | Effort-to-impact | Disposition | Primary dependency or constraint                          |
| ---: | ------------------------------------------------ | ---------- | ------ | ---------------- | ----------- | --------------------------------------------------------- |
|    1 | Private state and audit artifact permissions     | S          | High   | Excellent        | Required    | Supported-platform permission primitives                  |
|    2 | Single-supervisor ownership and port diagnostics | M          | High   | Excellent        | Required    | Reliable process identity and bounded probes              |
|    3 | Strict policy plumbing and mode-aware readiness  | M          | High   | Excellent        | Required    | Generated OpenClaw settings must agree with active mode   |
|    4 | Complete tool policy and outcome audit trail     | M          | High   | Excellent        | Required    | Correlated before, resolution, and after-tool events      |
|    5 | Runtime capability inventory and warnings        | M          | High   | Excellent        | Required    | Stable public runtime-inspection JSON                     |
|    6 | Process-tree cleanup and command timeouts        | M          | High   | Good             | Required    | Best-effort host-process supervision, not resource quotas |
|    7 | Stable CLI output and exit contract              | S          | Medium | Excellent        | Required    | Focused command-boundary tests                            |
|    8 | Supported host platform contract                 | S          | Medium | Excellent        | Required    | CI and operational evidence per advertised host           |
|    9 | Structured `doctor --json` output                | S          | Medium | Excellent        | Candidate   | Reuse the existing aggregate checks                       |
|   10 | Audit retention and size warnings                | S          | Medium | Excellent        | Required    | Preserve append-only and tail semantics                   |
|   11 | Native OpenClaw `approve` mode                   | L          | High   | Good             | Required    | Strict modes, audit trail, and an OpenClaw approval route |
|   12 | OpenClaw compatibility contract diagnostics      | M          | High   | Good             | Required    | Public SDK, hook, and runtime-inspection contracts        |
|   13 | Gateway environment passthrough policy           | M          | Medium | Good             | Candidate   | Separate Gateway and build environments                   |
|   14 | Explicit run-scoped `allow` mode                 | L          | High   | Fair             | Required    | Mode-aware profile policy and conspicuous risk UX         |
|   15 | `tail` filters and bounded event queries         | M          | Medium | Fair             | Candidate   | Preserve raw JSONL output semantics                       |
|   16 | Capability changes between successful builds     | M          | Medium | Fair             | Candidate   | Normalized runtime capability snapshots                   |

### Feature requirements

#### Private state and audit artifact permissions

- create DevGuard-owned project state and log directories with private permissions
- create Gateway tokens, snapshots, ownership markers, audit logs, and raw streams as private files
- retain existing permissions when they are stricter than the required maximum
- make `doctor` report overly broad permissions on supported hosts
- repair permissions only for canonical DevGuard-owned paths and never follow an ownership marker outside them

#### Single-supervisor ownership and port diagnostics

- acquire an exclusive per-project ownership marker before starting build, watch, or Gateway work
- include the run ID, process ID, project identity, configured port, and creation time in the marker
- distinguish a live owner from a stale marker using bounded host checks
- reject a second live supervisor with an actionable message
- diagnose an occupied Gateway port without killing or signaling an unrelated process
- release ownership after normal shutdown and safely recover a stale marker without claiming ownership of an unrelated process

#### Strict policy plumbing and mode-aware readiness

- parse only `deny`, `approve`, and `allow`
- resolve missing, unknown, and malformed policy state to `deny`
- expose the active mode through startup output, live Gateway status, logs, and `doctor`
- generate coherent OpenClaw exec, sandbox, workspace, and elevated-tool settings for the selected mode
- refuse readiness when the reported mode and generated profile disagree
- keep `allow` run-scoped rather than silently persisted

#### Runtime capability inventory and warnings

- consume public runtime-inspection output rather than private OpenClaw registries
- distinguish tool-pipeline-covered surfaces from hooks, services, routes, Gateway methods, channels, providers, and other uncovered runtime surfaces
- warn rather than fail for legitimate non-tool capabilities
- explain that registration and direct plugin code remain outside tool-policy enforcement

#### Complete tool policy and outcome audit trail

- correlate attempted, blocked, approval-requested, approval-resolved, allowed, completed, and failed outcomes where OpenClaw exposes them
- preserve target plugin pre- and post-tool lifecycle behavior
- redact sensitive inputs and avoid recording raw outputs by default
- block in every mode when a required audit record cannot be written

#### Stable CLI output and exit contract

- test success, operational failure, readiness failure, and operator-shutdown exit behavior
- keep human results on standard output and diagnostics on standard error
- preserve clean machine-readable standard output in every JSON mode
- reserve additional numeric exit codes until a real caller requires stable failure categories

#### Supported host platform contract

- derive the advertised host list from CI and operational evidence
- fail before state mutation on unsupported hosts
- exercise filesystem permissions, paths, signals, process ownership, and Gateway supervision on every supported host
- describe unsupported platforms explicitly rather than treating them as implicitly compatible

#### Native OpenClaw `approve` mode

- use `before_tool_call.requireApproval`; do not build a DevGuard approval interface
- initially offer `allow-once` and `deny` only
- deny on timeout, cancellation, missing approval routing, audit failure, or invalid resolution
- make clear that approval permits DevGuard to continue but does not override independent OpenClaw policy
- validate real approved and denied lifecycles with focused tests and CI-first operational coverage

#### Process supervision reliability

- add configurable build and validation timeouts
- terminate owned process trees where the supported host permits reliable process-group control
- preserve the last working Gateway when replacement work fails
- report incomplete cleanup without claiming hard CPU, memory, PID, or filesystem limits

#### OpenClaw compatibility contract diagnostics

- derive supported versions from canonical package and plugin metadata
- detect missing or changed public hooks, status fields, and runtime-inspection contracts before starting an unsafe or misleading session
- avoid private, hashed, or unexported OpenClaw modules
- provide actionable upgrade or compatibility errors

#### Gateway environment passthrough policy

- distinguish the target build environment from the Gateway runtime environment
- pass only an intentional Gateway baseline plus explicitly selected values
- report variable names rather than values
- describe this as credential hygiene, not target-plugin isolation

#### Audit retention and size warnings

- keep active records append-only and preserve them during `restore`
- define and document a size threshold that produces an actionable warning
- surface the warning through `run` and `doctor` without making log size a safety failure
- require explicit operator action before deleting, truncating, pruning, or rotating logs
- preserve complete JSONL records and predictable `tail` behavior if rotation is added later

#### Explicit run-scoped `allow` mode

- require an explicit CLI selection for each supervised run
- record that real side effects are possible before readiness
- audit every attempted and completed tool call while allowing the real OpenClaw result
- block instead of executing when required audit logging fails
- retain independent OpenClaw policy behavior
- never infer, persist, or fall back to `allow`

#### Diagnostic ergonomics

- make `doctor --json` represent the same checks as human output
- keep `tail --json` as an unmodified JSONL stream
- add filters or bounded queries without creating a database or telemetry service
- compare capability snapshots only after successful, verified builds

### Excluded feature evaluation

These items are intentionally not candidates on the path to `1.0.0`:

| Feature                                   | Complexity | Potential impact | Effort-to-impact | Reason excluded                                             |
| ----------------------------------------- | ---------- | ---------------- | ---------------- | ----------------------------------------------------------- |
| Full-Gateway container or VM mode         | XL         | High             | Poor             | Creates a separate isolation and runtime-management product |
| Standalone build and validation sandbox   | XL         | Medium           | Poor             | Duplicates container concerns and fragments the build loop  |
| Synthetic success or command simulation   | XL         | Medium           | Poor             | Fabricates state and crosses the real-execution boundary    |
| Tool fixtures or deterministic replay     | L–XL       | Medium           | Poor             | Depends on simulation and expands into a testing platform   |
| DevGuard-specific interactive approval UI | L          | Low              | Poor             | Duplicates native OpenClaw approval surfaces                |
| Direct Node.js API interception           | XL         | Low              | Poor             | Is bypassable and would create a false security boundary    |
| Production, remote, or multi-user policy  | XL         | Low              | Poor             | Conflicts with the local developer-workflow focus           |

## 1.0.0 Acceptance Criteria

`1.0.0` is ready when the current baseline and every `Required` backlog item satisfy focused tests and the following product outcomes:

1. A developer can initialize DevGuard against an external OpenClaw plugin repository with one command.
2. The normal OpenClaw profile is not mutated and ambient messaging channels are not connected.
3. `deny` is the default and malformed policy state cannot produce a permissive fallback.
4. Deterministic probes prove exec, filesystem mutation, and unknown tool attempts are captured and denied without executing.
5. Target plugin pre-tool hooks run before DevGuard's terminal decision and post-tool hooks receive the real blocked, approved, allowed, failed, or completed outcome exposed by OpenClaw.
6. `approve` uses native OpenClaw approval routing and denies on timeout, cancellation, missing routing, invalid resolution, or audit failure.
7. `allow` requires a conspicuous run-scoped selection, permits real OpenClaw execution, and blocks when required audit logging fails.
8. Startup output, live status, logs, and `doctor` agree on the active policy mode and loaded target build.
9. Sensitive environment values and tool inputs are redacted according to the logging contract.
10. DevGuard-owned state directories and sensitive artifacts use the private permission contract, and `doctor` reports unsafe permissions.
11. Only one live supervisor can own a project, and stale ownership or occupied ports fail with actionable diagnostics without signaling unrelated processes.
12. Human and JSON output boundaries and success, failure, and operator-shutdown exit behavior satisfy the CLI contract.
13. Every advertised host platform has CI and operational evidence for permissions, paths, signals, process ownership, and Gateway supervision.
14. Append-only audit logs warn at the documented size threshold and are never deleted or rotated implicitly.
15. Runtime capability inspection distinguishes tool-covered and uncovered plugin surfaces without claiming arbitrary-code isolation.
16. Editing the target plugin triggers non-overlapping build, validation, and controlled Gateway replacement while preserving the last working Gateway on failure.
17. Owned build, validation, and Gateway processes have bounded shutdown behavior, and incomplete process-tree cleanup is reported honestly.
18. OpenClaw public-contract incompatibilities fail with actionable diagnostics.
19. `restore` returns DevGuard-managed profile configuration to its prior state while preserving logs.
20. CI-first operational scenarios cover the default deny path and every real-execution mode without relying on the developer's normal OpenClaw profile.
21. Documentation clearly explains real side effects in `approve` and `allow`, direct target-plugin host access, and every excluded product boundary.

## Product Positioning

DevGuard should be positioned as:

> A reproducible, inspectable development supervisor for OpenClaw plugins, with explicit deny, approve, and allow policies for real OpenClaw tool calls.

It is not a production policy plugin, arbitrary-code sandbox, or simulation engine.

Its main value is combining:

- isolated development-profile management
- local plugin linking
- automatic build and Gateway restart
- tool-call capture
- explicit fail-closed policy handling
- safe redaction
- correlated logs
- runtime diagnostics
- reversible configuration
