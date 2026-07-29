# Development

This guide covers developing, testing, dogfooding, and releasing DevGuard itself. Start with the [README](./README.md) when using DevGuard with another plugin, and use [OPENCLAW.md](./OPENCLAW.md) for the complete runtime workflow.

## Requirements

- Bun from [.bun-version](./.bun-version) for installs, scripts, and builds
- Node.js from [.node-version](./.node-version) for tests and OpenClaw
- OpenClaw 2026.7.1-2 or newer

OpenClaw does not support running the Gateway under Bun. The build remains Node-targeted ESM with external package dependencies left external.

## Setup

```sh
bun install
```

Repository ownership is intentionally direct:

| Path       | Responsibility                              |
| ---------- | ------------------------------------------- |
| `index.ts` | Plugin registration                         |
| `cli/`     | One implementation file per subcommand      |
| `lib/`     | CLI registration and reusable orchestration |
| `utils/`   | Pure helpers                                |
| `scripts/` | Development and release tasks               |
| `test/`    | Flat behavior-focused unit tests            |

## Routine Validation

```sh
bun run lint
bun run typecheck
bun run test
bun run build
bun run plugin:check
```

Run the narrowest relevant check first while iterating, then complete this repository-only suite before handoff.

Filesystem notification behavior is kept outside the default unit suite. Run its focused integration check only when watcher behavior is directly in scope:

```sh
bun run test:integration
```

## Live Development

The lower-level loop develops DevGuard in OpenClaw's built-in `--dev` profile:

```sh
bun run dev:setup
bun run dev
```

`dev:setup` builds, links, and enables DevGuard in that profile. `dev` rebuilds DevGuard and restarts a foreground development Gateway when watched source changes. Both commands run OpenClaw and mutate its development profile, so they are opt-in operational tasks.

To dogfood the product-facing workflow instead:

```sh
bun run build
openclaw plugins install --link .
openclaw plugins enable openclaw-devguard
openclaw devguard init .
OPENCLAW_LOG_LEVEL=debug openclaw devguard run
```

This makes DevGuard both the guard and the target. Developing another plugin follows the per-target flow in [OPENCLAW.md](./OPENCLAW.md#development-model).

## Package Validation

```sh
bun run test:release
```

The release package test builds the plugin, validates its metadata, creates an npm archive, and confirms that the required runtime, manifest, source, CLI, and library files are present.

## Operational Scenarios

The CI-first Leia scenarios under [`examples/`](./examples/) run as entries in the existing macOS and Ubuntu example matrix. They cover:

- packed installation and CLI discovery
- repeated target initialization
- one bounded supervised run
- human and JSON event tailing
- aggregate live safety diagnostics
- generated-state removal and saved-config restoration
- watched rebuild and verified Gateway replacement
- live exec, write, and unknown-tool denial with audit redaction and correlation
- source model and portable authentication import
- selected agent workspace resolution with isolated agent and session state

Do not run direct OpenClaw commands, plugin installation, Gateway startup, or Leia scenarios as routine local validation. Keep these machine-mutating operational and end-to-end checks in the pull-request workflow matrix.

The manually dispatched `Live model test` workflow reuses the `model` Leia scenario for one real isolated-Gateway turn. It requires `TANAAB_ALTERNATE_MALE_KEY` and accepts the OpenAI model reference as a workflow input; it is not a pull-request gate.

## Release Model

GitHub Releases drive npm publishing. Stable releases publish to `latest`; prereleases publish to `edge`. npm trusted publishing owns publication, while repository secrets are scoped to dist-tag and release synchronization.

## Documentation Ownership

- `README.md` owns the common install, target initialization, first run, and verification path.
- `OPENCLAW.md` owns the complete OpenClaw integration, CLI, configuration, logging, and operational workflow.
- `DEVELOPMENT.md` owns contributor setup, validation, dogfooding, and release mechanics.
- `SPEC.md` owns product intent and the threat model, not implementation status.
- `CHANGELOG.md` records implemented changes.

Keep commands and status claims aligned with the repository before documenting them as functional.
