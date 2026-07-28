import assert from 'node:assert/strict';

import runtimeEventDisplay from '../utils/runtime-event-display.ts';

describe('utils/runtime-event-display', () => {
  it('should select concise human fields from tool and lifecycle events', () => {
    assert.deepEqual(
      runtimeEventDisplay({
        event: 'tool_call_attempted',
        params: { command: 'touch sentinel' },
        toolName: 'exec',
      }),
      {
        label: 'tool call attempted',
        target: 'exec',
        detail: 'touch sentinel',
      },
    );
    assert.deepEqual(
      runtimeEventDisplay({
        event: 'gateway_started',
        gatewayProcessId: 42,
        pluginBuildId: 'build-1',
      }),
      {
        label: 'gateway started',
        target: 'build-1',
        detail: 'pid 42',
      },
    );
  });

  it('should reject records without a stable event name', () => {
    assert.throws(() => runtimeEventDisplay({ pluginId: 'example-plugin' }), /event name/);
  });
});
