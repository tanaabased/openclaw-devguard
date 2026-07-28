import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { type ChildProcess } from 'node:child_process';

import createDevRunner from '../lib/dev-runner.ts';

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killCount = 0;

  kill(signal: NodeJS.Signals): boolean {
    this.killCount += 1;
    this.signalCode = signal;
    queueMicrotask(() => this.emit('exit', null, signal));
    return true;
  }
}

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

describe('lib/dev-runner', () => {
  it('should debounce builds and restart only after a successful build', async () => {
    let builds = 0;
    const children: FakeChild[] = [];
    const runner = createDevRunner({
      debounceMs: 5,
      build: async () => {
        builds += 1;
      },
      startGateway: () => {
        const child = new FakeChild();
        children.push(child);
        return child as unknown as ChildProcess;
      },
    });

    runner.requestBuild();
    runner.requestBuild();
    await wait(25);
    assert.equal(builds, 1);
    assert.equal(children.length, 1);

    runner.requestBuild();
    await wait(25);
    assert.equal(builds, 2);
    assert.equal(children.length, 2);
    assert.equal(children[0]?.killCount, 1);
    await runner.stop();
  });

  it('should keep the current Gateway alive when a build fails', async () => {
    let builds = 0;
    const children: FakeChild[] = [];
    const errors: unknown[] = [];
    const runner = createDevRunner({
      debounceMs: 5,
      build: async () => {
        builds += 1;
        if (builds === 2) throw new Error('synthetic build failure');
      },
      startGateway: () => {
        const child = new FakeChild();
        children.push(child);
        return child as unknown as ChildProcess;
      },
      onBuildError: (error) => errors.push(error),
    });

    runner.requestBuild();
    await wait(25);
    runner.requestBuild();
    await wait(25);

    assert.equal(errors.length, 1);
    assert.equal(children.length, 1);
    assert.equal(children[0]?.killCount, 0);
    await runner.stop();
  });
});
