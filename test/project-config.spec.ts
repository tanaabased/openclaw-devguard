import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createProjectConfig,
  findProjectRoot,
  parseProjectConfig,
  resolveProjectPaths,
} from '../lib/project-config.ts';

const validConfig = {
  version: 1,
  plugin: {
    id: 'example-plugin',
    build: { command: 'bun', args: ['run', 'build'] },
    validate: { command: 'bun', args: ['run', 'plugin:check'] },
    watch: ['src', 'package.json'],
  },
  policy: { mode: 'probe' },
  logging: { environmentValueAllowlist: ['NODE_ENV'] },
  gateway: { port: 19_001 },
};

describe('lib/project-config', () => {
  it('should parse the strict project configuration', () => {
    assert.deepEqual(parseProjectConfig(validConfig), validConfig);
  });

  it('should apply probe mode to an older configuration without a policy section', () => {
    const legacyConfig: Record<string, unknown> = { ...validConfig };
    delete legacyConfig.policy;
    assert.equal(parseProjectConfig(legacyConfig).policy.mode, 'probe');
  });

  it('should reject unknown keys instead of assuming permissive defaults', () => {
    assert.throws(
      () => parseProjectConfig({ ...validConfig, unsafe: true }),
      /contains unknown keys: unsafe/,
    );
  });

  it('should find the nearest project from a nested directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-project-root-'));
    const projectRoot = join(root, 'project');
    const nested = join(projectRoot, 'examples', 'nested');

    try {
      await mkdir(nested, { recursive: true });
      await Promise.all([
        writeFile(join(root, 'devguard.json'), JSON.stringify(validConfig)),
        writeFile(join(projectRoot, 'devguard.json'), JSON.stringify(validConfig)),
      ]);

      assert.equal(await findProjectRoot(nested), projectRoot);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('should explain how to initialize when no project can be found', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-no-project-'));

    try {
      await assert.rejects(
        () => findProjectRoot(root),
        /Could not find devguard\.json.*openclaw devguard init <plugin-path>/,
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('should infer plugin commands and watched entrypoints', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-project-config-'));

    try {
      await Promise.all([
        writeFile(
          join(root, 'package.json'),
          JSON.stringify({
            packageManager: 'bun@1.3.14',
            scripts: { build: 'build command', 'plugin:check': 'validation command' },
          }),
        ),
        writeFile(join(root, 'openclaw.plugin.json'), JSON.stringify({ id: 'example-plugin' })),
        writeFile(join(root, 'index.mjs'), 'export default {};\n'),
      ]);

      const config = await createProjectConfig(root);

      assert.deepEqual(config.plugin.build, { command: 'bun', args: ['run', 'build'] });
      assert.deepEqual(config.plugin.validate, {
        command: 'bun',
        args: ['run', 'plugin:check'],
      });
      assert.deepEqual(config.plugin.watch, ['index.mjs', 'openclaw.plugin.json', 'package.json']);
      assert.equal(config.policy.mode, 'probe');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('should derive stable isolated state outside the normal OpenClaw profile', () => {
    const paths = resolveProjectPaths('/workspace/example', 'example-plugin', {
      DEVGUARD_HOME: '/isolated/devguard',
      HOME: '/home/tester',
    });

    assert.match(paths.profileName, /^devguard-example-plugin-[a-f0-9]{12}$/);
    assert.ok(paths.profileName.length <= 64);
    assert.equal(paths.stateDirectory, `/home/tester/.openclaw-${paths.profileName}`);
    assert.match(paths.projectStateRoot, /^\/isolated\/devguard\/projects\/example-plugin-/);
    assert.match(paths.logPath, /\/logs\/events\.jsonl$/);
  });

  it('should sanitize and bound native profile names', () => {
    const paths = resolveProjectPaths('/workspace/example', `@scope/${'Plugin.Name'.repeat(10)}`, {
      HOME: '/home/tester',
    });

    assert.match(paths.profileName, /^[a-z0-9][a-z0-9_-]{0,63}$/);
    assert.equal(paths.profileName.length, 64);
  });
});
