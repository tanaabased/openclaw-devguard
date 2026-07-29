import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import profileDevguard from '../cli/profile.ts';
import { resolveProjectPaths } from '../lib/project-config.ts';

const config = {
  version: 1,
  plugin: {
    id: 'example-plugin',
    build: { command: 'bun', args: ['run', 'build'] },
    watch: ['index.ts'],
  },
  logging: { environmentValueAllowlist: [] },
  gateway: { port: 19_001 },
};

describe('cli/profile', () => {
  it('should print the initialized native OpenClaw profile name without decoration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-profile-'));
    const environment = {
      DEVGUARD_HOME: join(root, 'devguard-home'),
      HOME: join(root, 'user-home'),
    };
    const paths = resolveProjectPaths(root, config.plugin.id, environment);
    const nested = join(root, 'examples', 'profile');
    const writes: string[] = [];

    try {
      await Promise.all([
        mkdir(paths.projectStateRoot, { recursive: true }),
        mkdir(nested, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(join(root, 'devguard.json'), JSON.stringify(config)),
        writeFile(
          join(paths.projectStateRoot, 'init.json'),
          JSON.stringify({
            version: 2,
            profileName: paths.profileName,
            configPath: join(paths.stateDirectory, 'openclaw.json'),
            snapshotPath: null,
          }),
        ),
      ]);

      const result = await profileDevguard(nested, {
        environment,
        output: { writeStdout: (value) => writes.push(value) },
      });

      assert.equal(result, paths.profileName);
      assert.deepEqual(writes, [`${paths.profileName}\n`]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
