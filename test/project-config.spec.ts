import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createProjectConfig,
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
  logging: { environmentValueAllowlist: ['NODE_ENV'] },
  gateway: { port: 19_001 },
};

describe('lib/project-config', () => {
  it('should parse the strict project configuration', () => {
    assert.deepEqual(parseProjectConfig(validConfig), validConfig);
  });

  it('should reject unknown keys instead of assuming permissive defaults', () => {
    assert.throws(
      () => parseProjectConfig({ ...validConfig, unsafe: true }),
      /contains unknown keys: unsafe/,
    );
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
