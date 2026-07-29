# Leia Example Guidance

This file applies to `examples/**`. Scenario README files are executable Leia specifications that mutate isolated OpenClaw state on fresh CI runners.

## Scenario Rules

- Keep one user-visible flow per scenario and one behavior per `# should ...` block.
- Treat every blank-line-separated block as a separate script; do not rely on local variables or working-directory changes persisting between blocks.
- Keep executable commands inside the `Setup` and `Testing` fenced blocks.
- Prefer checked-in fixtures over README commands or helper scripts that synthesize static, deterministic input state.
- Keep scenario-owned fixtures directly beside their README; do not add a scenario-local `fixtures/` directory when the scenario directory already establishes ownership.
- Use root `fixtures/` only for a suite-level fixture shared across multiple examples or explicitly established for concrete near-term shared use.
- Reuse a repository-owned product asset directly when it is itself the test input; do not duplicate it as an example-only fixture.
- Keep real product registration, onboarding, and mutation commands when their supported behavior is part of the scenario contract; use fixtures to prepare inputs, not to bypass the public surface under test.
- Prefer direct `command | grep` assertions when one required command invocation has one output assertion; command cost alone is not a reason to persist its output.
- Capture command output only when the same invocation must support multiple assertions, a full-output or non-leak check, detaching or later inspecting a background process, or an output artifact that is itself the contract.
- Inspect DevGuard's existing logs directly when they are the observable lifecycle or safety record; do not duplicate command output into a temporary log merely to grep it.
- When one stateful invocation must support multiple assertions, capture it once and reuse that output instead of rerunning the command.
- Chain fixed-string greps when stable tokens must occur on the same line; do not make CLI alignment padding part of an operational scenario contract.
- Prefer public product CLI output, existing product logs, and ordinary shell assertions over repository-owned semantic checkers.
- Reserve `scripts/leia-*-cli.mjs` for bounded process coordination or relational assertions across multiple records that would be materially less clear or portable in shell.
- Do not use a helper to inspect OpenClaw configuration or authentication through SDK APIs when the scenario can prove its behavior through public CLI commands.
- Keep example-specific expected values in the owning README or fixture; shared support scripts must not embed fixture identities or other scenario-specific data.
- Use lowercase behavior prose unless exact command, flag, environment, product, or file casing is part of the contract.
- Do not use literal backticks or braced shell expansions inside executable blocks.
- Keep immediate child directories limited to matrix-backed scenario names; `AGENTS.md` and `package.json` remain root boundary files.
- Use root `fixtures/devguard-example-plugin` for the shared target-plugin path and root `fixtures/devbot-agent-workspace` for shared credential-free agent context; do not add `examples/fixtures` or `examples/support`.
- Keep the Devbot fixture free of config, auth, sessions, memory, and generated bootstrap state; populate its `assets/devbot.png` reference from the repository-owned asset at scenario runtime.
- Keep dogfooding DevGuard itself on its separate self-link path.
- Run these scenarios in CI by default; do not run them locally unless the user explicitly requests operational validation.
- Omit cleanup-only teardown on ephemeral CI runners. Add a cleanup phase only when teardown behavior is part of the contract or the suite operates on persistent state.
