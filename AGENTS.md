# OpenClaw DevGuard Agent Guidance

## Scope

- Keep implementation in its nearest owning scope: plugin registration in `index.ts`, one implementation file per OpenClaw subcommand in `cli/`, CLI registration and reusable orchestration in `lib/`, pure helpers in `utils/`, and development tasks in `scripts/`.
- Keep shared Leia target projects in `fixtures/`, shared executable Leia drivers in `scripts/`, and only matrix-backed scenario directories plus required boundary files in `examples/`.
- Keep tests flat in `test/` and name specs after the behavior they own.
- Treat `SPEC.md` as product intent, not evidence that a feature has been implemented.

## Product boundary

- Treat agent-requested tool activity as untrusted and target plugin code as developer-controlled. Keep DevGuard focused on supervising developer-controlled OpenClaw plugin workflows through public OpenClaw lifecycle, inspection, diagnostic, and tool-policy APIs.
- DevGuard may capture, deny, request native OpenClaw approval for, or explicitly pass through real tool calls. Deny must remain the default; approval and allow behavior must be explicit, auditable, visibly surfaced, and fail closed when configuration, approval routing, or audit logging fails.
- Keep the OpenClaw exec layer permissive enough for model transport and tool requests to reach DevGuard's hooks. Do not use `tools.exec.mode` as the deny-mode enforcement boundary.
- Do not expand DevGuard into an arbitrary-code isolation or simulation platform. Container or VM orchestration, direct Node.js API interception, synthetic tool success, command simulation, fixture or replay engines, production policy enforcement, and remote or multi-user runtime management are out of scope unless the project is explicitly rechartered.
- Keep OpenClaw Docker sandboxing disabled in generated profiles and operational tests. DevGuard must not require, build, or manage container images as part of its safety model.
- Prefer real OpenClaw execution outcomes and clearly stated limitations over fake success, permissive fallbacks, or partial isolation claims.

## Runtime and tooling

- Use the Bun version pinned in `.bun-version` for installs, scripts, and builds.
- Use the Node.js version pinned in `.node-version` for tests and OpenClaw itself; do not launch the Gateway under Bun.
- Keep TypeScript projects aligned with their runtime boundaries: root source uses Node.js types, development scripts use Bun and Node.js types, and tests use Mocha and Node.js types.
- Keep external package dependencies external in the Node-targeted ESM build.

## Documentation

- Keep `README.md` focused on installation, the common target-plugin path, and first verification.
- Put complete CLI, configuration, logging, and operational detail in `ADVANCED.md`.
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
- Run `bun run test:release` when package contents or release wiring are directly in scope.
- Do not run direct `openclaw` commands, plugin installation, or Gateway startup unless the user explicitly requests operational validation.
- Do not run Leia scenarios or other operational tests from `examples/` locally unless the user explicitly requests them; prefer CI for those scenarios.
- When operational validation is explicitly requested, use isolated OpenClaw state.
- Do not claim enforcement behavior until it exists and has focused tests.
