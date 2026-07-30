# OpenClaw DevGuard Product Specification

## Purpose

OpenClaw DevGuard is a local development supervisor for advanced OpenClaw plugin work. It gives a target plugin its own OpenClaw profile and Gateway, rebuilds it as source changes, and lets a developer observe agent-requested tool lifecycles while limiting unintended host mutation.

DevGuard is for developer-controlled plugin code and untrusted agent tool requests. It is not a security boundary for arbitrary code.

This specification records durable product intent, exclusions, and remaining work. The code, focused tests, operational examples, and changelog are the evidence for what a checkout currently implements. User-facing command and configuration details belong in [README.md](./README.md) and [ADVANCED.md](./ADVANCED.md).

## Current Product Contract

The current product has these public behaviors:

- `init` creates or validates `devguard.json`, derives isolated OpenClaw state, imports selected agents and bounded model/authentication configuration, installs the target and DevGuard, and validates the result.
- `profile`, `exec`, and `shell` make native OpenClaw commands practical against initialized isolated state without requiring users to export profile or state selectors.
- `run` acquires exclusive per-project ownership, diagnoses its loopback port without signaling another owner, then builds, validates, starts, verifies, watches, and replaces the target Gateway while retaining the last working Gateway after a replacement build or validation failure.
- `tail` exposes human-readable or raw JSONL audit events, `doctor` aggregates live checks, and `restore` removes or restores only DevGuard-managed isolated state while preserving logs.
- DevGuard's runtime policy activates only in a DevGuard-managed Gateway. Installing it in a normal profile exposes the CLI without guarding that profile's tools.
- `probe` is the default policy. It replaces `exec` with a fixed recorder, preserves the real OpenClaw tool-result lifecycle, and tells the agent that the original command did not run.
- `deny` is an explicit terminal-block mode. In both modes, unknown tools and tools without a probe are blocked.
- Only `exec` currently has a non-mutating probe. The external-plugin Leia scenario proves that `resolve_exec_env` can modify the recorder environment without executing the agent's requested command.

The public command group is:

```text
openclaw devguard init
openclaw devguard profile
openclaw devguard exec
openclaw devguard shell
openclaw devguard run
openclaw devguard tail
openclaw devguard doctor
openclaw devguard restore
```

## Product Invariants

### Trust boundary

- Agent-requested tool activity is untrusted.
- The target plugin and its dependencies are developer-controlled.
- DevGuard governs only activity that reaches public OpenClaw tool-policy hooks.
- Target imports, `register()`, lifecycle hooks, background workers, direct filesystem or network access, and directly spawned subprocesses remain ordinary Gateway process activity.
- Documentation must describe DevGuard as a development guardrail, never complete host isolation.

### Tool policy

- Missing policy configuration resolves to `probe`.
- Unknown or malformed policy configuration fails closed.
- A high-priority capture hook runs before target-plugin tool hooks, and a low-priority DevGuard policy hook makes the terminal decision after them.
- Required audit writes fail closed. DevGuard does not execute an original operation when its required attempt or policy record cannot be written.
- Probe results report the recorder's real result and explicitly state that the original operation did not run.
- DevGuard never manufactures synthetic tool success or lets an agent infer that requested side effects occurred.
- Any future mode that permits real execution must be explicitly selected for that run, visibly surfaced, audited, and never inferred or persisted as a fallback.
- `tools.exec.mode: full` is transport configuration that lets model tool requests reach DevGuard. It is not the DevGuard safety boundary.

Current policy behavior is intentionally small:

| Tool request       | `probe` mode                          | `deny` mode |
| ------------------ | ------------------------------------- | ----------- |
| `exec`             | Replace with recorder and audit       | Block       |
| Any other tool     | Block because no probe is implemented | Block       |
| Unknown tool names | Block                                 | Block       |

### Profile and runtime isolation

- DevGuard reads but does not mutate the selected source OpenClaw profile.
- Agent selections and OAuth consent remain machine-local and do not enter `devguard.json`.
- Imported workspaces remain host-path references; source sessions, channels, bindings, browser state, and broad source policy are not copied.
- Environment-backed credentials remain environment variables. Portable stored credentials may be copied into isolated agent state; non-portable OAuth requires explicit consent.
- Imported `openai/*` models use OpenClaw's built-in agent runtime so parameter rewrites and exec-environment hooks reach the probe. Explicit non-OpenAI runtime policy is preserved.
- Generated profiles keep ambient channels disabled, Docker sandboxing off, elevated tools disabled, and the Gateway bound to loopback with token authentication.
- Docker sandboxing is not part of DevGuard's safety model and must remain disabled in generated profiles and operational tests.

### Audit and restoration

- DevGuard writes append-only, project-specific JSONL events with correlated tool and lifecycle identifiers when OpenClaw exposes them.
- Environment values are omitted unless explicitly allowlisted. Credential-shaped names remain redacted even when allowlisted.
- Sensitive-data obfuscation is best effort; logs may contain prompts, commands, paths, identifiers, and values that do not look like credentials.
- Human output and diagnostics remain separate from machine-readable JSON output.
- `restore` affects only canonical DevGuard-owned state and preserves audit logs. It cannot reverse direct target-plugin side effects.

## Supported Hosts

The advertised host contract must follow exercised CI and operational evidence.

- macOS 26 and Ubuntu 24.04 are currently exercised.
- Windows is unsupported and must not be presented as compatible.
- Every DevGuard command should fail before project discovery or host interaction on an unsupported host.
- Platform-specific behavior includes permissions, paths, signals, child-process cleanup, and Gateway supervision.

## Product Boundaries and Non-Goals

The following work is intentionally outside the path to `1.0.0` unless the project is explicitly rechartered:

- container, VM, separate-account, or remote-host orchestration
- enabling, building, or managing OpenClaw Docker sandbox images
- isolation of arbitrary target-plugin imports, registration code, dependencies, or background work
- interception of direct Node.js, Bun, filesystem, subprocess, browser, or network APIs
- synthetic tool success, semantic command simulation, fixture playback, or agent-run replay
- a generic tool simulator or an obligation to probe every OpenClaw or plugin-defined tool
- a DevGuard-specific approval terminal, browser interface, or dashboard settings page
- a separate HTTP or public API surface that duplicates the CLI and existing Gateway status method
- production policy enforcement, remote Agent Box provisioning, or multi-user runtime management
- centralized databases, hosted telemetry, or log analytics
- automatic patching of OpenClaw or imports from private, hashed, or unexported OpenClaw modules
- mutation of the user's source profile to make an isolated development run work
- claims that logs are secret-free or that DevGuard can identify every sensitive value

Additional probes remain in scope only as exact adapters for stable public tool identities. They must replace the requested operation with a bounded action against disposable DevGuard-owned state, return the controlled action's real result, and state that the requested path, command, or external resource was not used.

## Remaining Work

### Evaluation rubric

- **Complexity:** `S` is one focused surface, `M` coordinates several modules or commands, `L` crosses policy and operational behavior, and `XL` changes the product boundary.
- **Impact:** `High` materially improves safety or the primary development loop, `Medium` improves recurring diagnosis or ergonomics, and `Low` serves a narrow convenience.
- **Leverage:** `Excellent` is a strong early investment, `Good` is worthwhile with bounded design work, `Fair` needs proportionally more coordination, and `Poor` does not justify its scope.
- **Disposition:** `Required` is part of the proposed stable `1.0.0` contract. `Candidate` may land before `1.0.0` but should not delay it without new evidence. `Deferred` needs a demonstrated workflow gap before implementation.

### Ranked backlog

| Rank | Improvement                                    | Complexity | Impact | Leverage | Disposition |
| ---: | ---------------------------------------------- | ---------- | ------ | -------- | ----------- |
|    1 | Bounded build, validation, and process cleanup | M          | High   | Good     | Required    |
|    2 | Native OpenClaw `approve` mode                 | L          | High   | Good     | Candidate   |
|    3 | Explicit run-scoped `allow` mode               | L          | Medium | Fair     | Candidate   |
|    4 | Additional exact-tool probes                   | M each     | Medium | Fair     | Candidate   |

### Required reliability work

#### Bounded build, validation, and process cleanup

- Add bounded build and validation timeouts with useful defaults and explicit overrides.
- Continue the existing graceful-then-forceful Gateway shutdown behavior.
- Terminate owned process trees where supported host process-group behavior makes ownership reliable.
- Preserve the last working Gateway after replacement build or validation failure.
- Report incomplete cleanup without claiming CPU, memory, PID, filesystem, or general resource isolation.

### High-value candidates

#### Native OpenClaw `approve` mode

- Make approval a conspicuous run-scoped selection rather than a persisted project default.
- Use the public `before_tool_call.requireApproval` contract and native OpenClaw approval surfaces.
- Initially offer `allow-once` and `deny`; do not build session-persistent approval policy until a real use case requires it.
- Deny on timeout, cancellation, missing approval routing, malformed resolution, or required audit failure.
- Record request and resolution, then preserve the real approved, denied, failed, or completed OpenClaw lifecycle.
- Require focused unit coverage and a CI-first operational scenario before describing the mode as supported.

#### Explicit `allow` mode

- Make real execution a conspicuous `run`-scoped choice that is never inferred or persisted in `devguard.json`.
- Surface the active mode in startup output, live status, logs, and `doctor`.
- Record attempts and real outcomes, while retaining independent OpenClaw policy behavior.
- Block rather than execute when required audit logging fails.
- Require operational evidence demonstrating real side effects and honest shutdown behavior.

#### Additional tool probes

- Add a probe only when a concrete plugin-development lifecycle cannot be tested with `exec` or terminal denial.
- Bind each probe to an exact stable built-in tool identity and a disposable DevGuard-owned target.
- Never generalize an adapter into filesystem isolation, command simulation, or replay infrastructure.
- Preserve the real downstream OpenClaw result and tell the agent what did not happen.

### Deprioritized work

- **Gateway environment allowlisting:** the Gateway currently needs inherited environment credentials, target code is developer-controlled, and this would not create an isolation boundary. Revisit only for a concrete credential-hygiene failure.
- **Full runtime capability inventory and build-to-build diffs:** current runtime inspection plus explicit boundary documentation covers the immediate need. Revisit when a real plugin surface produces misleading safety claims.
- **Built-in `tail` filters and bounded queries:** JSONL output already composes with `grep`, `jq`, and other command-line tools. Add dedicated filters only when recurring usage cannot be expressed clearly that way.
- **Separate policy-plumbing and audit-trail projects:** current `probe` and `deny` readiness and outcomes are implemented. Future `approve`, `allow`, or probe adapters must extend those contracts as part of their own work rather than creating parallel frameworks first.

## Stable Release Direction

`1.0.0` does not require every candidate feature. It requires the current isolated-profile, `probe`/`deny`, supervision, audit, diagnostics, and restoration contract to remain covered while the remaining Required reliability item is completed.

Any candidate mode included before `1.0.0` must have focused tests, CI-first operational evidence, accurate documentation, and fail-closed audit behavior. Unimplemented candidates must not appear in CLI help, accepted configuration, or user documentation as available functionality.

The stable product remains:

> A reproducible, inspectable local development supervisor for OpenClaw plugins that safely probes supported agent tool requests, blocks the rest, and makes the product boundary explicit.
