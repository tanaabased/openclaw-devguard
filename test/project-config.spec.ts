import assert from 'node:assert/strict';

import { parseProjectConfig, resolveProjectPaths } from '../lib/project-config.ts';

const validConfig = {
  version: 1,
  plugin: {
    id: 'example-plugin',
    build: { command: 'bun', args: ['run', 'build'] },
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

  it('should derive stable isolated state outside the normal OpenClaw profile', () => {
    const paths = resolveProjectPaths('/workspace/example', 'example-plugin', {
      DEVGUARD_HOME: '/isolated/devguard',
    });

    assert.match(paths.stateDirectory, /^\/isolated\/devguard\/projects\/example-plugin-/);
    assert.match(paths.stateDirectory, /\/state$/);
    assert.match(paths.logPath, /\/logs\/events\.jsonl$/);
  });
});
