# Leia Example Guidance

This file applies to `examples/**`. Scenario README files are executable Leia specifications that mutate isolated OpenClaw state on fresh CI runners.

## Scenario Rules

- Keep one user-visible flow per scenario and one behavior per `# should ...` block.
- Treat every blank-line-separated block as a separate script; do not rely on local variables or working-directory changes persisting between blocks.
- Keep executable commands inside the `Setup` and `Testing` fenced blocks.
- Prefer direct `command | grep` assertions when one required command invocation has one output assertion; command cost alone is not a reason to persist its output.
- Capture command output only when the same invocation must support multiple assertions, a full-output or non-leak check, detaching or later inspecting a background process, or an output artifact that is itself the contract.
- Inspect DevGuard's existing logs directly when they are the observable lifecycle or safety record; do not duplicate command output into a temporary log merely to grep it.
- When one stateful invocation must support multiple assertions, capture it once and reuse that output instead of rerunning the command.
- Chain fixed-string greps when stable tokens must occur on the same line; do not make CLI alignment padding part of an operational scenario contract.
- Prefer an existing semantic checker for complex structured contracts, but do not add a utility merely to replace a clear fixed-string JSON or JSONL assertion.
- Use lowercase behavior prose unless exact command, flag, environment, product, or file casing is part of the contract.
- Do not use literal backticks or braced shell expansions inside executable blocks.
- Keep immediate child directories limited to matrix-backed scenario names; `AGENTS.md` and `package.json` remain root boundary files.
- Use `fixtures/devguard-example-plugin` for the ordinary target-plugin path and `scripts/leia-*-cli.mjs` for shared drivers; do not add `examples/fixtures` or `examples/support`.
- Keep dogfooding DevGuard itself on its separate self-link path.
- Run these scenarios in CI by default; do not run them locally unless the user explicitly requests operational validation.
- Omit cleanup-only teardown on ephemeral CI runners. Add a cleanup phase only when teardown behavior is part of the contract or the suite operates on persistent state.
