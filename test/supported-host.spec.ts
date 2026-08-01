import assert from 'node:assert/strict';

import assertSupportedHost from '../utils/supported-host.ts';

describe('utils/supported-host', () => {
  it('should accept the advertised host platforms', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      assert.doesNotThrow(() => assertSupportedHost(platform));
    }
  });

  it('should reject platforms outside the advertised host contract', () => {
    for (const platform of ['win32', 'freebsd'] as const) {
      assert.throws(() => assertSupportedHost(platform), new RegExp(`platform ${platform}`));
    }
  });
});
