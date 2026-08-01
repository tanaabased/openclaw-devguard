import assert from 'node:assert/strict';

import inspectGatewayPort from '../utils/gateway-port.ts';

describe('utils/gateway-port', () => {
  it('should probe only the configured loopback address', async () => {
    const calls: Array<{ host: string; port: number }> = [];
    const result = await inspectGatewayPort(19_001, async (port, host) => {
      calls.push({ host, port });
    });

    assert.deepEqual(result, { available: true, host: '127.0.0.1', port: 19_001 });
    assert.deepEqual(calls, [{ host: '127.0.0.1', port: 19_001 }]);
  });

  it('should report an unavailable port without mutating its owner', async () => {
    const result = await inspectGatewayPort(19_001, async () => {
      throw new Error('address already in use');
    });

    assert.deepEqual(result, {
      available: false,
      detail: 'address already in use',
      host: '127.0.0.1',
      port: 19_001,
    });
  });
});
