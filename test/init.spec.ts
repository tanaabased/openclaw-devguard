import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { snapshotConfiguration } from '../cli/init.ts';

describe('cli/init', () => {
  it('should create a restorable marker when isolated config does not exist yet', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-init-marker-'));
    const projectStateRoot = join(root, 'project');
    const stateDirectory = join(root, '.openclaw-devguard-example');
    const profileName = 'devguard-example';

    try {
      assert.equal(
        await snapshotConfiguration(projectStateRoot, stateDirectory, profileName),
        undefined,
      );
      assert.deepEqual(JSON.parse(await readFile(join(projectStateRoot, 'init.json'), 'utf8')), {
        version: 2,
        profileName,
        configPath: join(stateDirectory, 'openclaw.json'),
        snapshotPath: null,
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
