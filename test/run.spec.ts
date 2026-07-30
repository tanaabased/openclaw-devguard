import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import runDevguard from '../cli/run.ts';
import { type Logger } from '../lib/logger.ts';
import { resolveProjectPaths } from '../lib/project-config.ts';
import { type SupervisorOwnership } from '../lib/supervisor-ownership.ts';

const logger: Logger = { info() {}, warn() {}, error() {} };

describe('cli/run', () => {
  it('should reject an unsupported host before project discovery', async () => {
    await assert.rejects(
      runDevguard('/path/that/does/not/exist', { logger, platform: 'win32' }),
      /platform win32 is unsupported/,
    );
  });

  it('should release ownership and explain an occupied Gateway port before supervision starts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-run-port-'));
    const environment = { DEVGUARD_HOME: join(root, 'home'), HOME: join(root, 'user-home') };
    const paths = resolveProjectPaths(root, 'example-plugin', environment);
    let released = false;
    const ownership: SupervisorOwnership = {
      lockPath: join(paths.projectStateRoot, 'supervisor.json.lock'),
      markerPath: join(paths.projectStateRoot, 'supervisor.json'),
      owner: {
        version: 1,
        hostname: 'test-host',
        pid: 42,
        port: 19_001,
        profileName: paths.profileName,
        projectRoot: root,
        runId: 'test-run',
        startedAt: '2026-07-30T12:00:00.000Z',
      },
      recoveredStaleOwner: false,
      release: async () => {
        released = true;
      },
    };

    try {
      await mkdir(dirname(paths.logPath), { recursive: true });
      await Promise.all([
        writeFile(
          join(root, 'devguard.json'),
          JSON.stringify({
            version: 1,
            plugin: {
              id: 'example-plugin',
              build: { command: 'bun', args: ['run', 'build'] },
              watch: ['index.ts'],
            },
            policy: { mode: 'probe' },
            logging: { environmentValueAllowlist: [] },
            gateway: { port: 19_001 },
          }),
        ),
        writeFile(
          join(paths.projectStateRoot, 'init.json'),
          JSON.stringify({
            version: 2,
            profileName: paths.profileName,
            configPath: join(paths.stateDirectory, 'openclaw.json'),
            snapshotPath: null,
          }),
        ),
        writeFile(join(paths.projectStateRoot, 'gateway-token'), 'gateway-secret\n'),
      ]);

      await assert.rejects(
        runDevguard(root, {
          acquireSupervisor: async () => ownership,
          environment,
          inspectPort: async (port) => ({
            available: false,
            detail: 'address already in use',
            host: '127.0.0.1',
            port,
          }),
          logger,
        }),
        /Gateway port 19001.*unavailable.*stop its current owner or change gateway\.port/,
      );
      assert.equal(released, true);
      const auditLog = await readFile(paths.logPath, 'utf8');
      assert.match(auditLog, /supervisor_acquired/);
      assert.match(auditLog, /gateway_port_unavailable/);
      assert.match(auditLog, /supervisor_released/);
      assert.doesNotMatch(auditLog, /build_started/);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
