# OpenClaw DevGuard Agent Guidance

## Scope

- Keep implementation in its nearest owning scope: plugin registration in `index.ts`, orchestration in `lib/`, pure helpers in `utils/`, and development tasks in `scripts/`.
- Keep tests flat in `test/` and name specs after the behavior they own.
- Treat `SPEC.md` as product intent, not evidence that a feature has been implemented.

## Runtime and tooling

- Use Bun 1.3.14 for installs, scripts, tests, and builds.
- Run OpenClaw itself with a supported Node.js runtime; do not launch the Gateway under Bun.
- Keep external package dependencies external in the Node-targeted ESM build.

## Validation

- Run `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`, and `bun run plugin:check` for implementation changes.
- Use isolated OpenClaw state for installation and runtime smoke tests.
- Do not claim enforcement behavior until it exists and has focused tests.
