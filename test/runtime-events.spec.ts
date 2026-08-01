import assert from 'node:assert/strict';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import createRuntimeEventRecorder, { type RuntimeEvent } from '../lib/runtime-events.ts';

describe('lib/runtime-events', () => {
  it('should create private lifecycle logs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-runtime-events-'));
    const logPath = join(root, 'logs', 'events.jsonl');

    try {
      const recorder = createRuntimeEventRecorder({ logPath });
      recorder.record({ event: 'build_started' });
      await recorder.flush();

      assert.equal((await lstat(dirname(logPath))).mode & 0o777, 0o700);
      assert.equal((await lstat(logPath)).mode & 0o777, 0o600);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('should serialize correlated lifecycle records in observation order', async () => {
    const records: RuntimeEvent[] = [];
    const recorder = createRuntimeEventRecorder({
      base: { pluginId: 'example-plugin', runId: 'run-123' },
      logPath: '/tmp/events.jsonl',
      now: () => new Date('2026-07-28T12:00:00.000Z'),
      append: async (_path, record) => {
        records.push(record);
      },
    });

    recorder.record({ event: 'build_started' });
    recorder.record({ event: 'build_succeeded', pluginBuildId: 'build-1' });
    await recorder.flush();

    assert.deepEqual(records, [
      {
        timestamp: '2026-07-28T12:00:00.000Z',
        pluginId: 'example-plugin',
        runId: 'run-123',
        event: 'build_started',
      },
      {
        timestamp: '2026-07-28T12:00:00.000Z',
        pluginId: 'example-plugin',
        runId: 'run-123',
        event: 'build_succeeded',
        pluginBuildId: 'build-1',
      },
    ]);
  });

  it('should continue recording after an append failure', async () => {
    const errors: unknown[] = [];
    const records: RuntimeEvent[] = [];
    let attempts = 0;
    const recorder = createRuntimeEventRecorder({
      logPath: '/tmp/events.jsonl',
      append: async (_path, record) => {
        attempts += 1;
        if (attempts === 1) throw new Error('disk unavailable');
        records.push(record);
      },
      onError: (error) => errors.push(error),
    });

    recorder.record({ event: 'build_started' });
    recorder.record({ event: 'build_failed' });
    await recorder.flush();

    assert.equal(errors.length, 1);
    assert.deepEqual(
      records.map(({ event }) => event),
      ['build_failed'],
    );
  });
});
