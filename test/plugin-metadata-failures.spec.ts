import assert from 'node:assert/strict';

import pluginMetadataFailures, {
  type PackageMetadata,
  type PluginManifest,
} from '../utils/plugin-metadata-failures.ts';

const packageMetadata: PackageMetadata = {
  name: '@tanaab/openclaw-devguard',
  version: 'test-version',
  openclaw: {
    extensions: ['./index.ts'],
    runtimeExtensions: ['./dist/index.js'],
  },
};

const manifest: PluginManifest = {
  id: 'openclaw-devguard',
  version: 'test-version',
  activation: {
    onStartup: true,
  },
  commandAliases: [{ name: 'devguard', kind: 'cli' }],
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
    assert.deepEqual(
      new Set(pluginMetadataFailures({}, {}).map(({ code }) => code)),
      new Set([
        'package-name',
        'plugin-id',
        'source-entry',
        'runtime-entry',
        'startup-activation',
        'cli-command',
        'config-schema-type',
        'config-schema-strictness',
      ]),
    );
  });

  it('should report version and schema drift independently', () => {
    assert.deepEqual(
      new Set(
        pluginMetadataFailures(
          { ...packageMetadata, version: 'other-version' },
          {
            ...manifest,
            configSchema: {
              ...manifest.configSchema,
              additionalProperties: true,
            },
          },
        ).map(({ code }) => code),
      ),
      new Set(['version-mismatch', 'config-schema-strictness']),
    );
  });
});
