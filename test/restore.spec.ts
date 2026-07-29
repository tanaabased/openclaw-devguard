import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import restoreDevguard from '../cli/restore.ts';
import { type Logger } from '../lib/logger.ts';
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
const logger: Logger = { info() {}, warn() {}, error() {} };

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('cli/restore', () => {
  it('should restore the original config, remove temporary state, and preserve logs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-restore-'));
    const devguardHome = join(root, 'home');
    const paths = resolveProjectPaths(root, config.plugin.id, { DEVGUARD_HOME: devguardHome });
    const configPath = join(paths.stateDirectory, 'openclaw.json');
    const markerPath = join(paths.projectStateRoot, 'init.json');
    const snapshotPath = join(paths.projectStateRoot, 'openclaw.before-devguard.json');
    const writes: string[] = [];

    try {
      await Promise.all([
        mkdir(paths.stateDirectory, { recursive: true }),
        mkdir(dirname(paths.logPath), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(join(root, 'devguard.json'), JSON.stringify(config)),
        writeFile(configPath, '{ devguard: true }\n'),
        writeFile(join(paths.stateDirectory, 'temporary.json'), '{}\n'),
        writeFile(snapshotPath, '{ original: true }\n'),
        writeFile(join(paths.projectStateRoot, 'gateway-token'), 'temporary-secret\n'),
        writeFile(paths.logPath, '{"event":"existing"}\n'),
        writeFile(markerPath, JSON.stringify({ version: 1, configPath, snapshotPath })),
      ]);

      const first = await restoreDevguard(root, {
        environment: { DEVGUARD_HOME: devguardHome },
        logger,
        output: { writeStdout: (value) => writes.push(value) },
      });
      const second = await restoreDevguard(root, {
        environment: { DEVGUARD_HOME: devguardHome },
        logger,
        output: { writeStdout: (value) => writes.push(value) },
      });

      assert.equal(first.changed, true);
      assert.equal(first.restoredSnapshot, true);
      assert.equal(second.changed, false);
      assert.equal(await readFile(configPath, 'utf8'), '{ original: true }\n');
      assert.equal(await exists(join(paths.stateDirectory, 'temporary.json')), false);
      assert.equal(await exists(markerPath), false);
      assert.equal(await exists(snapshotPath), false);
      assert.equal(await exists(join(paths.projectStateRoot, 'gateway-token')), false);
      const log = await readFile(paths.logPath, 'utf8');
      assert.match(log, /"event":"existing"/);
      assert.match(log, /"event":"configuration_restored"/);
      assert.match(stripVTControlCharacters(writes[0] ?? ''), /^restored\s+example-plugin/m);
      assert.match(stripVTControlCharacters(writes[1] ?? ''), /^unchanged\s+example-plugin/m);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('should resume cleanup after a crash completed the config restoration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-restore-crash-'));
    const devguardHome = join(root, 'home');
    const paths = resolveProjectPaths(root, config.plugin.id, { DEVGUARD_HOME: devguardHome });
    const configPath = join(paths.stateDirectory, 'openclaw.json');
    const markerPath = join(paths.projectStateRoot, 'init.json');
    const snapshotPath = join(paths.projectStateRoot, 'openclaw.before-devguard.json');

    try {
      await mkdir(paths.stateDirectory, { recursive: true });
      await Promise.all([
        writeFile(join(root, 'devguard.json'), JSON.stringify(config)),
        writeFile(configPath, '{ original: true }\n'),
        writeFile(
          markerPath,
          JSON.stringify({ version: 1, configPath, snapshotPath, phase: 'restored' }),
        ),
        writeFile(join(paths.projectStateRoot, 'gateway-token'), 'temporary-secret\n'),
      ]);

      await restoreDevguard(root, {
        environment: { DEVGUARD_HOME: devguardHome },
        logger,
        output: { writeStdout() {} },
      });

      assert.equal(await readFile(configPath, 'utf8'), '{ original: true }\n');
      assert.equal(await exists(markerPath), false);
      assert.equal(await exists(join(paths.projectStateRoot, 'gateway-token')), false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('should remove generated isolated state when no config existed before init', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-restore-generated-'));
    const devguardHome = join(root, 'home');
    const paths = resolveProjectPaths(root, config.plugin.id, { DEVGUARD_HOME: devguardHome });
    const configPath = join(paths.stateDirectory, 'openclaw.json');
    const markerPath = join(paths.projectStateRoot, 'init.json');

    try {
      await mkdir(paths.stateDirectory, { recursive: true });
      await Promise.all([
        writeFile(join(root, 'devguard.json'), JSON.stringify(config)),
        writeFile(configPath, '{ devguard: true }\n'),
        writeFile(markerPath, JSON.stringify({ version: 1, configPath, snapshotPath: null })),
      ]);

      const result = await restoreDevguard(root, {
        environment: { DEVGUARD_HOME: devguardHome },
        logger,
        output: { writeStdout() {} },
      });

      assert.equal(result.restoredSnapshot, false);
      assert.equal(await exists(paths.stateDirectory), false);
      assert.match(await readFile(paths.logPath, 'utf8'), /"restoredSnapshot":false/);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
