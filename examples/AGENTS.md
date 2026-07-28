# Leia Example Guidance

This file applies to `examples/**`. Scenario README files are executable Leia specifications that mutate isolated OpenClaw state on fresh CI runners.

## Scenario Rules

- Keep one user-visible flow per scenario and one behavior per `# should ...` block.
- Treat every blank-line-separated block as a separate script; do not rely on local variables or working-directory changes persisting between blocks.
- Keep executable commands inside the `Setup`, `Testing`, and `Destroy tests` fenced blocks.
- Use lowercase behavior prose unless exact command, flag, environment, product, or file casing is part of the contract.
- Do not use literal backticks or braced shell expansions inside executable blocks.
- Keep shared fixtures under `examples/fixtures/` only when at least two scenarios consume them.
- Run these scenarios in CI by default; do not run them locally unless the user explicitly requests operational validation.
- Remove only scenario-owned isolated state during cleanup and guard destructive paths with an exact expected `TMPDIR` check.
