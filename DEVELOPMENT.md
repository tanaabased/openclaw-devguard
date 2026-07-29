# Development

This guide covers installing, developing, testing, and dogfooding DevGuard itself. Start with the [README](./README.md) when using DevGuard with another plugin, and use [ADVANCED.md](./ADVANCED.md) for the complete runtime and reference material.

## Requirements

- Bun from [.bun-version](./.bun-version) for installs, scripts, and builds
- Node.js from [.node-version](./.node-version) for tests and OpenClaw
- OpenClaw 2026.7.1-2 or newer

OpenClaw does not support running the Gateway under Bun. The build remains Node-targeted ESM with external package dependencies left external.

## Install From Source

Install a linked development checkout in the normal OpenClaw profile:

```sh
# clone the repository and install its pinned dependencies.
git clone https://github.com/tanaabased/openclaw-devguard.git
cd openclaw-devguard
bun install

# build the node-targeted plugin.
bun run build

# if openclaw reports a conflicting installation, remove it before linking.
# openclaw plugins uninstall openclaw-devguard --force

# link and enable this checkout in the normal openclaw profile.
openclaw plugins install --link .
openclaw plugins enable openclaw-devguard

# confirm that openclaw can load the development build.
openclaw plugins inspect openclaw-devguard --runtime --json
openclaw plugins doctor
```

The uninstall step is intentionally optional. Do not remove an existing installation when it already points to the checkout you intend to develop. Enabling DevGuard in the normal profile exposes its CLI without activating tool policy in that profile's Gateway.

## Dogfood DevGuard

The primary development workflow makes DevGuard both the installed guard and the target plugin under supervision. Run the workflow from the repository root after completing the source installation.

Initialize the checkout and import an agent you can use for a live turn:

```sh
# replace my-agent with an agent configured in your normal openclaw profile.
openclaw devguard init . --agent my-agent
```

The selected agent must exist in the source profile. A live model-backed turn also requires usable model configuration and authentication in that profile so `init` can project them into isolated state.

Start the supervised Gateway in the first terminal:

```sh
OPENCLAW_LOG_LEVEL=debug openclaw devguard run
```

This foreground process builds and validates DevGuard, starts its isolated Gateway, reports DevGuard and target-plugin diagnostics, and watches the configured source paths. Saving a change triggers another build; the active Gateway is replaced only after the new build and validation succeed.

For example, suppose the change under development adds or inspects `DEVGUARD_EXAMPLE=1` on exec tool requests. Add a temporary debug log at the point where the hook observes or changes the request, save the source, and wait for the first terminal to report the replacement Gateway as ready.

In a second terminal, ask the imported agent to make an exec request:

```sh
cd /path/to/openclaw-devguard

openclaw devguard exec -- agent \
  --agent my-agent \
  --session-key devguard-dogfood \
  --message "Use the exec tool to print the value of DEVGUARD_EXAMPLE." \
  --json
```

> [!IMPORTANT]
> DevGuard deny mode blocks the exec request, so no child command runs and there is no final process environment to inspect. The first terminal can show diagnostics from the hook being developed. The DevGuard audit log proves that the agent attempted the tool and that DevGuard blocked it. If the change mutates tool arguments, log the hook's post-mutation view while developing; DevGuard's early capture record is not proof of the final would-be process environment. Sensitive-data obfuscation is best effort, so treat audit logs as sensitive and expect ordinary tool arguments to remain visible.

Inspect the recorded tool lifecycle and the live isolated environment while `run` remains active:

```sh
# read the current complete audit records without following.
openclaw devguard tail --no-follow

# verify the isolated profile, target build, and deny hook.
openclaw devguard doctor
```

Stop supervision with `Ctrl-C`. Restoring is optional between development sessions; when needed, run it only after supervision has stopped:

```sh
openclaw devguard restore
```

For lower-level work that cannot yet use the product-facing dogfood path, DevGuard also supports OpenClaw's built-in `--dev` profile:

```sh
bun run dev:setup
bun run dev
```

`dev:setup` builds, links, and enables DevGuard in the OpenClaw development profile. `dev` rebuilds DevGuard and restarts a foreground development Gateway with DevGuard policy active when watched source changes. Both commands mutate that development profile, so use them as explicit operational tasks rather than routine validation.

## Testing

Run the narrowest relevant check while iterating, then complete the repository-only suite before handoff.

### Linting And Type Checking

[ESLint](https://eslint.org/) checks JavaScript and TypeScript behavior, [Prettier](https://prettier.io/) checks formatting, and [TypeScript](https://www.typescriptlang.org/) checks the root, development-script, and test runtime boundaries:

```sh
bun run lint
bun run typecheck
```

`bun run lint` runs both ESLint and the Prettier formatting check.

### Unit Tests

The default test suite uses [Mocha](https://mochajs.org/) and keeps behavior-focused specifications flat in [`test/`](./test/):

```sh
bun run test
```

Test DevGuard's adapter decisions and public contracts without duplicating OpenClaw's own library coverage.

### Watcher Integration

Filesystem notifications and process timing stay outside the default unit suite. Run the focused integration check only when watcher behavior is directly in scope:

```sh
bun run test:integration
```

### Build And Package Validation

Build the Node-targeted runtime, validate the OpenClaw plugin contract, and inspect the release-shaped package when those surfaces are in scope:

```sh
bun run build
bun run plugin:check
bun run test:release
```

The release-package check builds the plugin, validates its metadata, creates an npm archive, and confirms that the required runtime, manifest, source, CLI, library, asset, and documentation files are present.

### Leia Scenarios

The [Leia](https://github.com/lando/leia) scenarios under [`examples/`](./examples/) run as matrix entries in the [example-test workflow](./.github/workflows/pr-examples-tests.yml) on macOS and Ubuntu. Most dogfood DevGuard's self-target path; the [`plugin`](./examples/plugin/) scenario owns the separate external-plugin boundary.

> [!WARNING]
> Leia scenarios install plugins, initialize OpenClaw profiles, start Gateways, invoke models, and remove generated state. They are designed for isolated GitHub Actions runners and should not be run as routine local validation.

Keep operational and end-to-end evidence in that workflow rather than reproducing it with direct local OpenClaw commands.

## Coding Standards

DevGuard follows the shared JavaScript, CLI, documentation, and Leia conventions in the [Tanaab Canon repository](https://github.com/tanaabased/canon). The repository's [AGENTS.md](./AGENTS.md) adds DevGuard-specific product, OpenClaw, test, and validation boundaries.

Repository ownership is intentionally direct:

| Path       | Responsibility                              |
| ---------- | ------------------------------------------- |
| `index.ts` | Plugin registration                         |
| `cli/`     | One implementation file per subcommand      |
| `lib/`     | CLI registration and reusable orchestration |
| `utils/`   | Pure helpers                                |
| `scripts/` | Development and release tasks               |
| `test/`    | Flat behavior-focused unit tests            |

Keep implementation in its nearest owning scope, prefer direct public CLI and Gateway checks in Leia examples, and verify visible behavior before documenting a feature as functional.
