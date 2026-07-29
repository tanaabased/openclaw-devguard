import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import shellDevguard, { type ShellCommandRunner } from '../cli/shell.ts';
import { resolveProjectPaths } from '../lib/project-config.ts';

const config = {
  version: 1,
  plugin: {
    id: 'example-plugin',
    build: { command: 'bun', args: ['run', 'build'] },
    watch: ['index.ts'],
  },
  logging: { environmentValueAllowlist: [] },
  gateway: { port: 19_001 },
};

async function createInitializedProject(shell = '/bin/zsh'): Promise<{
  environment: NodeJS.ProcessEnv;
  nested: string;
  paths: ReturnType<typeof resolveProjectPaths>;
  root: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'devguard-shell-'));
  const environment = {
    DEVGUARD_HOME: join(root, 'devguard-home'),
    HOME: join(root, 'user-home'),
    OPENCLAW_CONFIG_PATH: '/source/openclaw.json',
    OPENCLAW_PROFILE: 'source',
    OPENCLAW_STATE_DIR: '/source/state',
    SHELL: shell,
    SOURCE_ONLY: 'retained',
  };
  const paths = resolveProjectPaths(root, config.plugin.id, environment);
  const nested = join(root, 'examples', 'shell');

  await Promise.all([
    mkdir(paths.projectStateRoot, { recursive: true }),
    mkdir(nested, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(root, 'devguard.json'), JSON.stringify(config)),
    writeFile(
      join(paths.projectStateRoot, 'init.json'),
      JSON.stringify({
        version: 2,
        profileName: paths.profileName,
        configPath: join(paths.stateDirectory, 'openclaw.json'),
        snapshotPath: null,
      }),
    ),
  ]);

  return { environment, nested, paths, root };
}

describe('cli/shell', () => {
  it('should open an inherited login shell in initialized isolated state', async () => {
    const fixture = await createInitializedProject();
    const calls: Parameters<ShellCommandRunner>[] = [];
    const runCommand: ShellCommandRunner = async (...args) => {
      calls.push(args);
      return { code: 23, output: '' };
    };

    try {
      const exitCode = await shellDevguard(fixture.nested, {
        environment: fixture.environment,
        runCommand,
      });

      assert.equal(exitCode, 23);
      assert.equal(calls.length, 1);
      const [command, commandArguments, commandOptions] = calls[0] ?? [];
      assert.equal(command, '/bin/zsh');
      assert.deepEqual(commandArguments, ['-l']);
      assert.equal(commandOptions?.allowFailure, true);
      assert.equal(commandOptions?.cwd, fixture.root);
      assert.equal(commandOptions?.inherit, true);
      assert.equal(commandOptions?.inheritStdin, true);
      assert.deepEqual(commandOptions?.env, {
        DEVGUARD_HOME: fixture.environment.DEVGUARD_HOME,
        HOME: fixture.environment.HOME,
        OPENCLAW_CONFIG_PATH: join(fixture.paths.stateDirectory, 'openclaw.json'),
        OPENCLAW_PROFILE: fixture.paths.profileName,
        OPENCLAW_SKIP_CHANNELS: '1',
        OPENCLAW_STATE_DIR: fixture.paths.stateDirectory,
        SHELL: '/bin/zsh',
        SOURCE_ONLY: 'retained',
      });
      assert.deepEqual(fixture.environment, {
        DEVGUARD_HOME: join(fixture.root, 'devguard-home'),
        HOME: join(fixture.root, 'user-home'),
        OPENCLAW_CONFIG_PATH: '/source/openclaw.json',
        OPENCLAW_PROFILE: 'source',
        OPENCLAW_STATE_DIR: '/source/state',
        SHELL: '/bin/zsh',
        SOURCE_ONLY: 'retained',
      });
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it('should fall back to the supported host shell when SHELL is empty', async () => {
    const fixture = await createInitializedProject('   ');
    const calls: Parameters<ShellCommandRunner>[] = [];

    try {
      const exitCode = await shellDevguard(fixture.root, {
        environment: fixture.environment,
        runCommand: async (...args) => {
          calls.push(args);
          return { code: 0, output: '' };
        },
      });

      assert.equal(exitCode, 0);
      assert.equal(calls[0]?.[0], '/bin/sh');
      assert.deepEqual(calls[0]?.[1], ['-l']);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it('should reject a project that has not initialized isolated state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-shell-uninitialized-'));
    const environment = {
      DEVGUARD_HOME: join(root, 'devguard-home'),
      HOME: join(root, 'user-home'),
      SHELL: '/bin/sh',
    };

    try {
      await writeFile(join(root, 'devguard.json'), JSON.stringify(config));

      await assert.rejects(
        () => shellDevguard(root, { environment }),
        /isolated state is not initialized/,
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
