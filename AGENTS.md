# OpenClaw DevGuard Agent Guidance

## Scope

- Keep implementation in its nearest owning scope: plugin registration in `index.ts`, one implementation file per OpenClaw subcommand in `cli/`, CLI registration and reusable orchestration in `lib/`, pure helpers in `utils/`, and development tasks in `scripts/`.
- Keep tests flat in `test/` and name specs after the behavior they own.
- Treat `SPEC.md` as product intent, not evidence that a feature has been implemented.

## Runtime and tooling

- Use the Bun version pinned in `.bun-version` for installs, scripts, and builds.
- Use the Node.js version pinned in `.node-version` for tests and OpenClaw itself; do not launch the Gateway under Bun.
- Keep TypeScript projects aligned with their runtime boundaries: root source uses Node.js types, development scripts use Bun and Node.js types, and tests use Mocha and Node.js types.
- Keep external package dependencies external in the Node-targeted ESM build.

## Documentation

- Keep `README.md` focused on installation, the common target-plugin path, and first verification.
- Put OpenClaw integration, CLI, configuration, logging, and operational detail in `OPENCLAW.md`.
- Put contributor setup, validation, dogfooding, and release mechanics in `DEVELOPMENT.md`.
- Treat `SPEC.md` as product intent and `CHANGELOG.md` as the record of implemented changes.

## OpenClaw integration

- Inspect the installed OpenClaw SDK types, stable `openclaw/plugin-sdk/*` exports, and bundled plugin patterns before creating local logging, error, runtime, command, or CLI UX mechanisms.
- Prefer injected SDK contexts such as `PluginLogger` and runtime interfaces over process-global behavior when they fit the surface.
- Keep normal command output separate from diagnostic logging, and retain a small local abstraction when the SDK mechanism does not preserve the required CLI behavior.
- Do not import private, hashed, or otherwise unexported OpenClaw implementation modules.

## Test design

- Assert exact values only for stable public, protocol, configuration, and safety contracts.
- For diagnostic logs and human-readable errors, assert the owned semantic signal instead of duplicating complete prose in unrelated specs.
- Derive real version expectations from their canonical metadata source; use clearly synthetic versions for fixtures.
- Keep wall-clock waits, filesystem notifications, process timing, and other environment-sensitive behavior out of unit tests; use deterministic injected boundaries or a separately invoked integration check.
- Test local adapter decisions rather than re-testing third-party library behavior.

## Validation

- Run `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`, and `bun run plugin:check` for implementation changes.
- Run `bun run test:integration` only when filesystem-watcher behavior is directly in scope.
- Run `bun run release:test` when package contents or release wiring are directly in scope.
- Do not run direct `openclaw` commands, plugin installation, or Gateway startup unless the user explicitly requests operational validation.
- Do not run Leia scenarios or other operational tests from `examples/` locally unless the user explicitly requests them; prefer CI for those scenarios.
- When operational validation is explicitly requested, use isolated OpenClaw state.
- Do not claim enforcement behavior until it exists and has focused tests.
