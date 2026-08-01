import assert from 'node:assert/strict';

import isolatedOpenClawEnvironment, {
  openClawProfileArguments,
} from '../utils/isolated-openclaw-environment.ts';

describe('utils/isolated-openclaw-environment', () => {
  it('should replace source selectors with one isolated native profile', () => {
    const source = {
      OPENCLAW_CONFIG_PATH: '/source/openclaw.json',
      OPENCLAW_PROFILE: 'source',
      OPENCLAW_STATE_DIR: '/source/state',
      SOURCE_ONLY: 'retained',
    };

    const isolated = isolatedOpenClawEnvironment(
      source,
      {
        profileName: 'devguard-example-123',
        stateDirectory: '/home/tester/.openclaw-devguard-example-123',
      },
      { OPENCLAW_SKIP_CHANNELS: '1' },
    );

    assert.deepEqual(isolated, {
      OPENCLAW_CONFIG_PATH: '/home/tester/.openclaw-devguard-example-123/openclaw.json',
      OPENCLAW_PROFILE: 'devguard-example-123',
      OPENCLAW_SKIP_CHANNELS: '1',
      OPENCLAW_STATE_DIR: '/home/tester/.openclaw-devguard-example-123',
      SOURCE_ONLY: 'retained',
    });
    assert.equal(source.OPENCLAW_CONFIG_PATH, '/source/openclaw.json');
    assert.equal(source.OPENCLAW_PROFILE, 'source');
    assert.equal(source.OPENCLAW_STATE_DIR, '/source/state');
  });

  it('should place the profile selector before the openclaw command', () => {
    assert.deepEqual(openClawProfileArguments('devguard-example', ['plugins', 'list']), [
      '--profile',
      'devguard-example',
      'plugins',
      'list',
    ]);
  });
});
