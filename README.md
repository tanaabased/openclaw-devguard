# OpenClaw DevGuard

[![Lint](https://github.com/tanaabased/openclaw-devguard/actions/workflows/pr-linter.yml/badge.svg)](https://github.com/tanaabased/openclaw-devguard/actions/workflows/pr-linter.yml)
[![Unit tests](https://github.com/tanaabased/openclaw-devguard/actions/workflows/pr-unit-tests.yml/badge.svg)](https://github.com/tanaabased/openclaw-devguard/actions/workflows/pr-unit-tests.yml)

OpenClaw DevGuard is an OpenClaw plugin intended to make plugin development safer, more observable, and easier to recover. The current version is a **structural scaffold**: it installs, loads, and exposes the planned CLI, but it does not yet enforce safety policy or protect a Gateway from destructive behavior.

The complete product intent and threat model live in [SPEC.md](./SPEC.md). That document is a design target; this README describes only behavior present in the repository today.

## What works today

- An official `definePluginEntry`-based OpenClaw plugin entry.
- Lazy registration of the `openclaw devguard` command tree.
- A Node-targeted ESM bundle produced with Bun while leaving package dependencies external.
- Unit, metadata, packed-install, runtime-load, and command-discovery checks.
- A source watcher that rebuilds and restarts only the Gateway process it owns.

Every unfinished DevGuard command exits with an explicit “not implemented” error. No command silently pretends that safeguards are active.

## Requirements

- [Bun](https://bun.sh/) 1.3.14 for installs, scripts, tests, and builds.
- OpenClaw 2026.7.1-2 or newer.
- A Node.js version supported by OpenClaw: `>=22.22.3 <23`, `>=24.15.0 <25`, or `>=25.9.0`.

OpenClaw does not support running the Gateway under Bun. The development scripts use Bun as tooling and launch the Gateway through the `openclaw` Node CLI.

## Develop from source

```bash
bun install
bun run dev:setup
bun run dev
```

`dev:setup` builds the package, links it into OpenClaw's isolated `--dev` profile, and enables the plugin there. `dev` watches the plugin source and metadata. A successful build restarts its owned development Gateway; a failed build leaves the previous Gateway running.

The development Gateway uses OpenClaw's `--dev` profile and port defaults. The watcher does not pass `--force`, so it will not kill an unrelated process already listening on that port.

## CLI surface

Once the plugin is installed and enabled, the scaffold exposes:

```text
openclaw devguard init [plugin-path]
openclaw devguard run [--unsafe-raw-stream]
openclaw devguard tail [--json]
openclaw devguard doctor
openclaw devguard restore
```

`--help` is functional. Command actions are intentionally unfinished and return a nonzero error.

## Validate

```bash
bun run lint
bun run typecheck
bun run test
bun run build
bun run plugin:check
bun run release:test
```

`release:test` packs the npm artifact, installs it into disposable OpenClaw state, loads the compiled runtime entry, runs OpenClaw's plugin doctor, checks CLI help, and verifies an unfinished command fails honestly. It does not modify the user's normal OpenClaw profile.

OpenClaw's `plugins validate` command currently validates tool-only authoring scaffolds, so this mixed CLI plugin uses runtime inspection and doctor checks instead.

## Release model

GitHub Releases drive npm publication. Stable releases publish to `latest`; prereleases publish to `edge`. npm trusted publishing handles `npm publish`, while the `TANAAB_NPM_DEPLOY` secret is scoped only to synchronizing the `edge` dist-tag after a stable release. `TANAAB_COAXIUM_INJECTOR` handles release commit and tag synchronization.

## License

OpenClaw DevGuard is licensed under the [MIT License](./LICENSE).
