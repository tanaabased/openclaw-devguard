import assert from 'node:assert/strict';
import { join } from 'node:path';

import parseRestoreMarker from '../utils/restore-marker.ts';

describe('utils/restore-marker', () => {
  const projectStateRoot = '/devguard/project';
  const stateDirectory = '/home/tester/.openclaw-devguard-example';
  const profileName = 'devguard-example';

  it('should accept only the canonical DevGuard profile and paths', () => {
    assert.deepEqual(
      parseRestoreMarker(
        {
          version: 2,
          profileName,
          configPath: join(stateDirectory, 'openclaw.json'),
          snapshotPath: join(projectStateRoot, 'openclaw.before-devguard.json'),
        },
        projectStateRoot,
        stateDirectory,
        profileName,
      ),
      {
        version: 2,
        profileName,
        configPath: join(stateDirectory, 'openclaw.json'),
        snapshotPath: join(projectStateRoot, 'openclaw.before-devguard.json'),
      },
    );
  });

  it('should reject profile or path references outside the canonical isolated state', () => {
    assert.throws(
      () =>
        parseRestoreMarker(
          {
            version: 2,
            profileName,
            configPath: '/normal/openclaw.json',
            snapshotPath: null,
          },
          projectStateRoot,
          stateDirectory,
          profileName,
        ),
      /unexpected config path/,
    );
    assert.throws(
      () =>
        parseRestoreMarker(
          {
            version: 2,
            profileName: 'another-profile',
            configPath: join(stateDirectory, 'openclaw.json'),
            snapshotPath: null,
          },
          projectStateRoot,
          stateDirectory,
          profileName,
        ),
      /unexpected OpenClaw profile/,
    );
  });

  it('should reject legacy project-local state with migration guidance', () => {
    assert.throws(
      () =>
        parseRestoreMarker(
          {
            version: 1,
            configPath: join(projectStateRoot, 'state', 'openclaw.json'),
            snapshotPath: null,
          },
          projectStateRoot,
          stateDirectory,
          profileName,
        ),
      /legacy project-local state/,
    );
  });
});
