import assert from 'node:assert/strict';
import { type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import {
  type CreateOwnedProcessDeadline,
  OwnedProcessCleanupError,
  OwnedProcessTimeoutError,
  stopOwnedProcess,
  waitForOwnedProcess,
} from '../lib/owned-process.ts';

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  pid: number | undefined = 42;
  signalCode: NodeJS.Signals | null = null;
}

const asChildProcess = (child: FakeChild): ChildProcess => child as unknown as ChildProcess;

describe('lib/owned-process', () => {
  it('should stop a detached process group gracefully', async () => {
    const signals: NodeJS.Signals[] = [];
    const cleanup = await stopOwnedProcess(asChildProcess(new FakeChild()), {
      groupAlive: () => true,
      phase: 'build',
      shutdownGraceMs: 5_000,
      signalGroup: (_pid, signal) => signals.push(signal),
      waitForGroupExit: async () => true,
    });

    assert.deepEqual(cleanup, {
      outcome: 'terminated',
      phase: 'build',
      pid: 42,
      signals: ['SIGTERM'],
    });
    assert.deepEqual(signals, ['SIGTERM']);
  });

  it('should force a process group that ignores graceful termination', async () => {
    const signals: NodeJS.Signals[] = [];
    let waits = 0;
    const cleanup = await stopOwnedProcess(asChildProcess(new FakeChild()), {
      groupAlive: () => true,
      phase: 'gateway',
      shutdownGraceMs: 5_000,
      signalGroup: (_pid, signal) => signals.push(signal),
      waitForGroupExit: async () => {
        waits += 1;
        return waits === 2;
      },
    });

    assert.deepEqual(cleanup, {
      outcome: 'killed',
      phase: 'gateway',
      pid: 42,
      signals: ['SIGTERM', 'SIGKILL'],
    });
    assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  });

  it('should accept a process group that exits before it can be signalled', async () => {
    const missing = Object.assign(new Error('no such process'), { code: 'ESRCH' });
    const cleanup = await stopOwnedProcess(asChildProcess(new FakeChild()), {
      groupAlive: () => true,
      phase: 'build',
      shutdownGraceMs: 5_000,
      signalGroup: () => {
        throw missing;
      },
    });

    assert.deepEqual(cleanup, {
      outcome: 'already-exited',
      phase: 'build',
      pid: 42,
      signals: [],
    });
  });

  it('should report a process group that remains after forceful termination', async () => {
    const cleanup = await stopOwnedProcess(asChildProcess(new FakeChild()), {
      groupAlive: () => true,
      phase: 'validation',
      shutdownGraceMs: 5_000,
      signalGroup() {},
      waitForGroupExit: async () => false,
    });

    assert.deepEqual(cleanup, {
      detail: 'process group remained active after SIGKILL',
      outcome: 'incomplete',
      phase: 'validation',
      pid: 42,
      signals: ['SIGTERM', 'SIGKILL'],
    });
    assert.match(new OwnedProcessCleanupError(cleanup).message, /pid 42.*terminate it manually/);
  });

  it('should stop and report a timed-out process through injected boundaries', async () => {
    let expire = (): void => undefined;
    let cancelled = false;
    const createDeadline: CreateOwnedProcessDeadline = () => ({
      cancel: () => {
        cancelled = true;
      },
      elapsed: new Promise<void>((resolve) => {
        expire = resolve;
      }),
    });
    const child = new FakeChild();
    const waiting = waitForOwnedProcess(asChildProcess(child), {
      createDeadline,
      phase: 'build',
      shutdownGraceMs: 5_000,
      stopProcess: async () => ({
        outcome: 'killed',
        phase: 'build',
        pid: 42,
        signals: ['SIGTERM', 'SIGKILL'],
      }),
      timeoutMs: 120_000,
    });

    expire();
    await assert.rejects(waiting, (error: unknown) => {
      assert.ok(error instanceof OwnedProcessTimeoutError);
      assert.equal(error.code, 'DEVGUARD_PROCESS_TIMEOUT');
      assert.equal(error.timeoutMs, 120_000);
      assert.equal(error.cleanup.outcome, 'killed');
      return true;
    });
    assert.equal(cancelled, true);
  });

  it('should reject an exited leader whose descendants cannot be cleaned up', async () => {
    const child = new FakeChild();
    child.exitCode = 0;

    await assert.rejects(
      waitForOwnedProcess(asChildProcess(child), {
        createDeadline: () => ({ cancel() {}, elapsed: new Promise<void>(() => undefined) }),
        phase: 'build',
        shutdownGraceMs: 5_000,
        stopProcess: async () => ({
          detail: 'process group remained active after SIGKILL',
          outcome: 'incomplete',
          phase: 'build',
          pid: 42,
          signals: ['SIGTERM', 'SIGKILL'],
        }),
        timeoutMs: 120_000,
      }),
      OwnedProcessCleanupError,
    );
  });

  it('should clean up an owned group after a child process error', async () => {
    const child = new FakeChild();
    let stopCalls = 0;
    const waiting = waitForOwnedProcess(asChildProcess(child), {
      createDeadline: () => ({ cancel() {}, elapsed: new Promise<void>(() => undefined) }),
      phase: 'validation',
      shutdownGraceMs: 5_000,
      stopProcess: async () => {
        stopCalls += 1;
        return {
          outcome: 'terminated',
          phase: 'validation',
          pid: 42,
          signals: ['SIGTERM'],
        };
      },
      timeoutMs: 120_000,
    });
    const error = new Error('child process error');

    child.emit('error', error);
    await assert.rejects(waiting, error);
    assert.equal(stopCalls, 1);
  });

  it('should return cancellation without treating it as a timeout', async () => {
    let cancelWait = (): void => undefined;
    let stopCalls = 0;
    const result = waitForOwnedProcess(asChildProcess(new FakeChild()), {
      cancelled: new Promise<void>((resolve) => {
        cancelWait = resolve;
      }),
      createDeadline: () => ({ cancel() {}, elapsed: new Promise<void>(() => undefined) }),
      phase: 'build',
      shutdownGraceMs: 5_000,
      stopProcess: async () => {
        stopCalls += 1;
        return { outcome: 'terminated', phase: 'build', pid: 42, signals: ['SIGTERM'] };
      },
      timeoutMs: 120_000,
    });

    cancelWait();
    assert.deepEqual(await result, { kind: 'cancelled' });
    assert.equal(stopCalls, 0);
  });
});
