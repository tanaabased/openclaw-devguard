import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import execDevguard, { type ExecCommandRunner } from '../cli/exec.ts';
import { resolveProjectPaths } from '../lib/project-config.ts';

const config = {
  version: 1,
  plugin: {
    id: 'example-plugin',
    build: { command: 'bun', args: ['run', 'build'] },
    watch: ['index.ts'],
  },
  policy: { mode: 'probe' },
  logging: { environmentValueAllowlist: [] },
  gateway: { port: 19_001 },
};

describe('cli/exec', () => {
  it('should reject an unsupported host before argument validation', async () => {
    await assert.rejects(
      execDevguard('/path/that/does/not/exist', [], { platform: 'win32' }),
      /platform win32 is unsupported/,
    );
  });

  it('should run OpenClaw against initialized isolated state and preserve its exit code', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-exec-'));
    const environment = {
      DEVGUARD_HOME: join(root, 'devguard-home'),
      HOME: join(root, 'user-home'),
      OPENCLAW_CONFIG_PATH: '/source/openclaw.json',
      OPENCLAW_PROFILE: 'source',
      OPENCLAW_STATE_DIR: '/source/state',
      SOURCE_ONLY: 'retained',
    };
    const paths = resolveProjectPaths(root, config.plugin.id, environment);
    const nested = join(root, 'examples', 'exec');
    const calls: Parameters<ExecCommandRunner>[] = [];
    const runCommand: ExecCommandRunner = async (...args) => {
      calls.push(args);
      return { code: 23, output: '' };
    };

    try {
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

      const exitCode = await execDevguard(
        nested,
        ['config', 'get', 'ui.assistant.name', '--json'],
        {
          environment,
          runCommand,
        },
      );

      assert.equal(exitCode, 23);
      assert.equal(calls.length, 1);
      const [command, commandArguments, commandOptions] = calls[0] ?? [];
      assert.equal(command, 'openclaw');
      assert.deepEqual(commandArguments, [
        '--profile',
        paths.profileName,
        'config',
        'get',
        'ui.assistant.name',
        '--json',
      ]);
      assert.equal(commandOptions?.allowFailure, true);
      assert.equal(commandOptions?.cwd, root);
      assert.equal(commandOptions?.inherit, true);
      assert.equal(commandOptions?.inheritStdin, true);
      assert.deepEqual(commandOptions?.env, {
        DEVGUARD_HOME: environment.DEVGUARD_HOME,
        HOME: environment.HOME,
        OPENCLAW_CONFIG_PATH: join(paths.stateDirectory, 'openclaw.json'),
        OPENCLAW_PROFILE: paths.profileName,
        OPENCLAW_SKIP_CHANNELS: '1',
        OPENCLAW_STATE_DIR: paths.stateDirectory,
        SOURCE_ONLY: 'retained',
      });
      assert.deepEqual(environment, {
        DEVGUARD_HOME: join(root, 'devguard-home'),
        HOME: join(root, 'user-home'),
        OPENCLAW_CONFIG_PATH: '/source/openclaw.json',
        OPENCLAW_PROFILE: 'source',
        OPENCLAW_STATE_DIR: '/source/state',
        SOURCE_ONLY: 'retained',
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('should require command arguments', async () => {
    await assert.rejects(() => execDevguard('.', []), /arguments are required after --/);
  });

  it('should reject a project that has not initialized isolated state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-exec-uninitialized-'));
    const environment = {
      DEVGUARD_HOME: join(root, 'devguard-home'),
      HOME: join(root, 'user-home'),
    };

    try {
      await writeFile(join(root, 'devguard.json'), JSON.stringify(config));

      await assert.rejects(
        () => execDevguard(root, ['config', 'file'], { environment }),
        /isolated state is not initialized/,
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
