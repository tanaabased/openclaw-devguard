import assert from 'node:assert/strict';
import { join } from 'node:path';

import parseRestoreMarker from '../utils/restore-marker.ts';

describe('utils/restore-marker', () => {
  it('should accept only the canonical DevGuard config and snapshot paths', () => {
    const projectStateRoot = '/devguard/project';
    const stateDirectory = join(projectStateRoot, 'state');

    assert.deepEqual(
      parseRestoreMarker(
        {
          version: 1,
          configPath: join(stateDirectory, 'openclaw.json'),
          snapshotPath: join(projectStateRoot, 'openclaw.before-devguard.json'),
        },
        projectStateRoot,
        stateDirectory,
      ),
      {
        version: 1,
        configPath: join(stateDirectory, 'openclaw.json'),
        snapshotPath: join(projectStateRoot, 'openclaw.before-devguard.json'),
      },
    );
  });

  it('should reject paths outside the canonical isolated state', () => {
    assert.throws(
      () =>
        parseRestoreMarker(
          { version: 1, configPath: '/normal/openclaw.json', snapshotPath: null },
          '/devguard/project',
          '/devguard/project/state',
        ),
      /unexpected config path/,
    );
  });
});
