# Leia Example Guidance

This file applies to `examples/**`. Scenario README files are executable Leia specifications that mutate isolated OpenClaw state on fresh CI runners.

## Scenario Rules

- Keep one user-visible flow per scenario and one behavior per `# should ...` block.
- Treat every blank-line-separated block as a separate script; do not rely on local variables or working-directory changes persisting between blocks.
- Keep executable commands inside the `Setup` and `Testing` fenced blocks.
- Prefer checked-in fixtures over README commands or helper scripts that synthesize static, deterministic input state.
- Keep scenario-owned fixtures directly beside their README; do not add a scenario-local `fixtures/` directory when the scenario directory already establishes ownership.
- Hoist inputs to root `fixtures/` only when they are shared across multiple examples or explicitly established for concrete near-term shared use.
- Reuse a repository-owned product asset directly when it is itself the test input; do not duplicate it as an example-only fixture.
- Keep real product registration, onboarding, and mutation commands when their supported behavior is part of the scenario contract; use fixtures to prepare inputs, not to bypass the public surface under test.
- Use the fresh runner's default OpenClaw profile for source setup unless named-profile behavior is itself under test.
- Use `openclaw devguard exec -- ...` for native OpenClaw commands against initialized isolated state; reserve `devguard profile` for scenarios that specifically test profile output, and do not set `OPENCLAW_STATE_DIR` directly.
- Use `openclaw devguard shell` only when the login-shell environment is the scenario contract; keep scripted native OpenClaw assertions on `devguard exec` so their commands remain visible.
- Prefer direct `command | grep` assertions when one required command invocation has one output assertion; command cost alone is not a reason to persist its output.
- Capture command output only when the same invocation must support multiple assertions, a full-output or non-leak check, detaching or later inspecting a background process, or an output artifact that is itself the contract.
- Inspect DevGuard's existing logs directly when they are the observable lifecycle or safety record; do not duplicate command output into a temporary log merely to grep it.
- When one stateful invocation must support multiple assertions, capture it once and reuse that output instead of rerunning the command.
- Chain fixed-string greps when stable tokens must occur on the same line; do not make CLI alignment padding part of an operational scenario contract.
- Prefer public product CLI output, existing product logs, and ordinary shell assertions over repository-owned semantic checkers.
- Keep product behavior assertions visible in the README; do not hide expected values or policy outcomes in helper scripts.
- Move bounded polling, shutdown, and similar process coordination into a clearly named executable Bash script beside the owning scenario when the inline shell would obscure the user flow.
- Do not use JavaScript for scenario-local coordination that Bash can express directly, and do not create shared helpers until multiple scenarios genuinely need one maintained contract.
- Do not add preflight `test` checks for files, commands, or environment variables that the next product command necessarily consumes; keep existence and absence checks only when that state is itself the behavior under test.
- Do not use a helper to inspect OpenClaw configuration or authentication through SDK APIs when the scenario can prove its behavior through public CLI commands.
- Keep example-specific expected values in the owning README or fixture; shared support scripts must not embed fixture identities or other scenario-specific data.
- Use lowercase behavior prose unless exact command, flag, environment, product, or file casing is part of the contract.
- Do not use literal backticks or braced shell expansions inside executable blocks.
- Keep immediate child directories limited to matrix-backed scenario names; `AGENTS.md` and `package.json` remain root boundary files.
- Dogfood the DevGuard repository as the target when another plugin's behavior is incidental to the scenario.
- Keep the separate target plugin directly in `examples/plugin`; extend that scenario when a real external-plugin flow needs additional tools, hooks, configuration, or lifecycle behavior.
- Keep scenario-owned agent workspaces directly in the owning example and copy them to temporary paths before passing them to OpenClaw commands.
- Ignore bootstrap, memory, and other runtime content that OpenClaw may generate in checked-in example workspaces; commit only the static files the scenario owns.
- Keep test-only probe methods in the scenario-owned example plugin rather than the published DevGuard plugin.
- Run these scenarios in CI by default; do not run them locally unless the user explicitly requests operational validation.
- Omit cleanup-only teardown on ephemeral CI runners. Add a cleanup phase only when teardown behavior is part of the contract or the suite operates on persistent state.
