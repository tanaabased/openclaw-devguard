import assert from 'node:assert/strict';

import pluginMetadataFailures, {
  type PackageMetadata,
  type PluginManifest,
} from '../utils/plugin-metadata-failures.ts';

const packageMetadata: PackageMetadata = {
  name: '@tanaabased/openclaw-devguard',
  version: '0.0.0',
  openclaw: {
    extensions: ['./index.ts'],
    runtimeExtensions: ['./dist/index.js'],
  },
};

const manifest: PluginManifest = {
  id: 'openclaw-devguard',
  version: '0.0.0',
  activation: {
    onStartup: false,
    onCommands: ['devguard'],
  },
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
};

describe('utils/plugin-metadata-failures', () => {
  it('should accept aligned package and plugin metadata', () => {
    assert.deepEqual(pluginMetadataFailures(packageMetadata, manifest), []);
  });

  it('should report every scaffold contract mismatch', () => {
    assert.deepEqual(pluginMetadataFailures({}, {}), [
      'unexpected npm package name',
      'unexpected OpenClaw plugin id',
      'source entry missing',
      'runtime entry missing',
      'plugin must not activate on startup',
      'command activation missing',
      'config schema must describe an object',
      'config schema must be strict',
    ]);
  });

  it('should report version and configuration drift independently', () => {
    assert.deepEqual(
      pluginMetadataFailures(
        { ...packageMetadata, version: '1.0.0' },
        {
          ...manifest,
          configSchema: {
            ...manifest.configSchema,
            properties: { unexpected: { type: 'boolean' } },
          },
        },
      ),
      ['package and manifest versions differ', 'structural scaffold must not expose config'],
    );
  });
});
