import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FILE_LOCK_TIMEOUT_ERROR_CODE, type FileLockHandle } from 'openclaw/plugin-sdk/file-lock';

import acquireSupervisorOwnership, {
  parseSupervisorOwner,
  supervisorMarkerPath,
} from '../lib/supervisor-ownership.ts';

function owner(runId: string): Record<string, unknown> {
  return {
    version: 1,
    hostname: 'test-host',
    pid: 42,
    port: 19_001,
    profileName: 'devguard-example',
    projectRoot: '/workspace/example',
    runId,
    startedAt: '2026-07-30T12:00:00.000Z',
  };
}

function fakeLock(releases: string[]): (path: string) => Promise<FileLockHandle> {
  return async (path) => {
    const lockPath = `${path}.lock`;
    await writeFile(lockPath, '{}\n', { mode: 0o644 });
    return {
      lockPath,
      async release() {
        releases.push(lockPath);
        await unlink(lockPath).catch(() => undefined);
      },
    };
  };
}

describe('lib/supervisor-ownership', () => {
  it('should acquire private ownership and release only its own marker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-supervisor-'));
    const stateRoot = join(root, 'state');
    const releases: string[] = [];
    try {
      await mkdir(stateRoot, { recursive: true });
      const ownership = await acquireSupervisorOwnership({
        acquireLock: fakeLock(releases),
        hostname: 'test-host',
        now: () => new Date('2026-07-30T12:00:00.000Z'),
        pid: 42,
        port: 19_001,
        profileName: 'devguard-example',
        projectRoot: '/workspace/example',
        projectStateRoot: stateRoot,
        runId: 'run-1',
      });

      assert.equal(ownership.recoveredStaleOwner, false);
      assert.deepEqual(
        parseSupervisorOwner(JSON.parse(await readFile(ownership.markerPath, 'utf8'))),
        owner('run-1'),
      );
      assert.equal((await lstat(ownership.markerPath)).mode & 0o777, 0o600);
      assert.equal((await lstat(ownership.lockPath)).mode & 0o777, 0o600);
      await ownership.release();
      await assert.rejects(readFile(ownership.markerPath, 'utf8'), /ENOENT/);
      assert.deepEqual(releases, [ownership.lockPath]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('should reject a held owner with actionable metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-supervisor-'));
    const stateRoot = join(root, 'state');
    try {
      await mkdir(stateRoot, { recursive: true });
      await writeFile(supervisorMarkerPath(stateRoot), JSON.stringify(owner('run-1')), {
        mode: 0o600,
      });
      await assert.rejects(
        acquireSupervisorOwnership({
          acquireLock: async () => {
            throw Object.assign(new Error('locked'), { code: FILE_LOCK_TIMEOUT_ERROR_CODE });
          },
          port: 19_001,
          profileName: 'devguard-example',
          projectRoot: '/workspace/example',
          projectStateRoot: stateRoot,
          runId: 'run-2',
        }),
        /pid 42 on test-host/,
      );
      assert.equal(
        JSON.parse(await readFile(supervisorMarkerPath(stateRoot), 'utf8')).runId,
        'run-1',
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('should replace stale owner metadata only after acquiring the lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-supervisor-'));
    const stateRoot = join(root, 'state');
    const releases: string[] = [];
    try {
      await mkdir(stateRoot, { recursive: true });
      await writeFile(supervisorMarkerPath(stateRoot), JSON.stringify(owner('stale-run')), {
        mode: 0o600,
      });
      const ownership = await acquireSupervisorOwnership({
        acquireLock: fakeLock(releases),
        hostname: 'test-host',
        now: () => new Date('2026-07-30T13:00:00.000Z'),
        pid: 84,
        port: 19_001,
        profileName: 'devguard-example',
        projectRoot: '/workspace/example',
        projectStateRoot: stateRoot,
        runId: 'run-2',
      });

      assert.equal(ownership.recoveredStaleOwner, true);
      assert.equal(JSON.parse(await readFile(ownership.markerPath, 'utf8')).runId, 'run-2');
      await ownership.release();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('should preserve replacement metadata while releasing the underlying lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-supervisor-'));
    const stateRoot = join(root, 'state');
    const releases: string[] = [];
    try {
      await mkdir(stateRoot, { recursive: true });
      const ownership = await acquireSupervisorOwnership({
        acquireLock: fakeLock(releases),
        port: 19_001,
        profileName: 'devguard-example',
        projectRoot: '/workspace/example',
        projectStateRoot: stateRoot,
        runId: 'run-1',
      });
      await writeFile(ownership.markerPath, JSON.stringify(owner('run-2')), { mode: 0o600 });

      await assert.rejects(ownership.release(), /owner changed before release/);
      assert.equal(JSON.parse(await readFile(ownership.markerPath, 'utf8')).runId, 'run-2');
      assert.deepEqual(releases, [ownership.lockPath]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('should reject malformed owner metadata while another lock is held', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-supervisor-'));
    const stateRoot = join(root, 'state');
    try {
      await mkdir(stateRoot, { recursive: true });
      await writeFile(supervisorMarkerPath(stateRoot), '{');
      await chmod(supervisorMarkerPath(stateRoot), 0o600);
      await assert.rejects(
        acquireSupervisorOwnership({
          acquireLock: async () => {
            throw Object.assign(new Error('locked'), { code: FILE_LOCK_TIMEOUT_ERROR_CODE });
          },
          port: 19_001,
          profileName: 'devguard-example',
          projectRoot: '/workspace/example',
          projectStateRoot: stateRoot,
          runId: 'run-2',
        }),
        /metadata is malformed or unreadable/,
      );
      assert.equal(await readFile(supervisorMarkerPath(stateRoot), 'utf8'), '{');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
