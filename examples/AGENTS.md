# Leia Example Guidance

This file applies to `examples/**`. Scenario README files are executable Leia specifications that mutate isolated OpenClaw state on fresh CI runners.

## Scenario Rules

- Keep one user-visible flow per scenario and one behavior per `# should ...` block.
- Treat every blank-line-separated block as a separate script; do not rely on local variables or working-directory changes persisting between blocks.
- Keep executable commands inside the `Setup` and `Testing` fenced blocks.
- Use lowercase behavior prose unless exact command, flag, environment, product, or file casing is part of the contract.
- Do not use literal backticks or braced shell expansions inside executable blocks.
- Keep immediate child directories limited to matrix-backed scenario names; `AGENTS.md` and `package.json` remain root boundary files.
- Use `fixtures/devguard-example-plugin` for the ordinary target-plugin path and `scripts/leia-*-cli.mjs` for shared drivers; do not add `examples/fixtures` or `examples/support`.
- Keep dogfooding DevGuard itself on its separate self-link path.
- Run these scenarios in CI by default; do not run them locally unless the user explicitly requests operational validation.
- Omit cleanup-only teardown on ephemeral CI runners. Add a cleanup phase only when teardown behavior is part of the contract or the suite operates on persistent state.
