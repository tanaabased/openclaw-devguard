import assert from 'node:assert/strict';

import isolatedOpenClawEnvironment from '../utils/isolated-openclaw-environment.ts';

describe('utils/isolated-openclaw-environment', () => {
  it('should select isolated state without retaining an explicit source config path', () => {
    const source = {
      OPENCLAW_CONFIG_PATH: '/source/openclaw.json',
      OPENCLAW_STATE_DIR: '/source/state',
      SOURCE_ONLY: 'retained',
    };

    const isolated = isolatedOpenClawEnvironment(source, '/isolated/state', {
      OPENCLAW_SKIP_CHANNELS: '1',
    });

    assert.deepEqual(isolated, {
      OPENCLAW_SKIP_CHANNELS: '1',
      OPENCLAW_STATE_DIR: '/isolated/state',
      SOURCE_ONLY: 'retained',
    });
    assert.equal(source.OPENCLAW_CONFIG_PATH, '/source/openclaw.json');
    assert.equal(source.OPENCLAW_STATE_DIR, '/source/state');
  });
});
