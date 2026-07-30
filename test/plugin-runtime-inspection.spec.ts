import assert from 'node:assert/strict';

import parsePluginRuntimeInspection from '../utils/plugin-runtime-inspection.ts';

function inspection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    plugin: { id: 'example-plugin', status: 'loaded' },
    typedHooks: [{ name: 'before_tool_call', priority: 1_000 }],
    cliCommands: ['example'],
    gatewayMethods: ['example.status'],
    compatibility: [],
    ...overrides,
  };
}

describe('utils/plugin-runtime-inspection', () => {
  it('should normalize the public runtime inspection fields', () => {
    assert.deepEqual(parsePluginRuntimeInspection(inspection(), 'example-plugin'), {
      cliCommands: ['example'],
      compatibility: [],
      gatewayMethods: ['example.status'],
      pluginId: 'example-plugin',
      typedHooks: ['before_tool_call'],
    });
  });

  it('should reject another plugin or a plugin that is not loaded', () => {
    assert.throws(
      () =>
        parsePluginRuntimeInspection(
          inspection({ plugin: { id: 'other-plugin', status: 'loaded' } }),
          'example-plugin',
        ),
      /other-plugin instead of example-plugin/,
    );
    assert.throws(
      () =>
        parsePluginRuntimeInspection(
          inspection({
            plugin: { id: 'example-plugin', status: 'error', error: 'registration failed' },
          }),
          'example-plugin',
        ),
      /example-plugin as error: registration failed/,
    );
  });

  it('should reject changed public inspection fields', () => {
    assert.throws(
      () =>
        parsePluginRuntimeInspection(
          inspection({ typedHooks: ['before_tool_call'] }),
          'example-plugin',
        ),
      /typedHooks has an unexpected value/,
    );
    assert.throws(
      () =>
        parsePluginRuntimeInspection(inspection({ gatewayMethods: undefined }), 'example-plugin'),
      /gatewayMethods has an unexpected value/,
    );
    assert.throws(
      () =>
        parsePluginRuntimeInspection(
          inspection({ compatibility: [{ severity: 'warning', message: 'legacy hook' }] }),
          'example-plugin',
        ),
      /compatibility has an unexpected value/,
    );
  });
});
