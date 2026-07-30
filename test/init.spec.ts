import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import initDevguard, { snapshotConfiguration } from '../cli/init.ts';
import { type Logger } from '../lib/logger.ts';

const logger: Logger = { info() {}, warn() {}, error() {} };

describe('cli/init', () => {
  it('should reject an unsupported host before inspecting the plugin', async () => {
    await assert.rejects(
      initDevguard('/path/that/does/not/exist', { logger, platform: 'win32' }),
      /platform win32 is unsupported/,
    );
  });

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
