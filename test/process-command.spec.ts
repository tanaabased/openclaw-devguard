import assert from 'node:assert/strict';
import { type ChildProcess, type SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { type CreateOwnedProcessDeadline, OwnedProcessTimeoutError } from '../lib/owned-process.ts';
import processCommand from '../lib/process-command.ts';

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  pid = 42;
  signalCode: NodeJS.Signals | null = null;
  stderr = null;
  stdin = null;
  stdout = null;
}

describe('lib/process-command', () => {
  it('should own and bound a configured command process', async () => {
    let spawnOptions: SpawnOptions | undefined;
    let expire = (): void => undefined;
    const createDeadline: CreateOwnedProcessDeadline = () => ({
      cancel() {},
      elapsed: new Promise<void>((resolve) => {
        expire = resolve;
      }),
    });
    const child = new FakeChild();
    const command = processCommand('build-tool', ['build'], {
      createDeadline,
      phase: 'build',
      shutdownGraceMs: 1_000,
      spawnProcess: (_command, _args, options) => {
        spawnOptions = options;
        return child as unknown as ChildProcess;
      },
      stopProcess: async (_child, options) => ({
        outcome: 'killed',
        phase: options.phase,
        pid: 42,
        signals: ['SIGTERM', 'SIGKILL'],
      }),
      timeoutMs: 2_000,
    });

    expire();
    await assert.rejects(command, (error: unknown) => {
      assert.ok(error instanceof OwnedProcessTimeoutError);
      assert.equal(error.phase, 'build');
      assert.equal(error.timeoutMs, 2_000);
      return true;
    });
    assert.equal(spawnOptions?.detached, true);
  });

  it('should leave unbounded commands attached', async () => {
    let spawnOptions: SpawnOptions | undefined;
    const child = new FakeChild();
    const command = processCommand('openclaw', ['plugins', 'doctor'], {
      spawnProcess: (_command, _args, options) => {
        spawnOptions = options;
        queueMicrotask(() => child.emit('exit', 0, null));
        return child as unknown as ChildProcess;
      },
    });

    assert.deepEqual(await command, { code: 0, output: '' });
    assert.equal(spawnOptions?.detached, false);
  });
});
