import assert from 'node:assert/strict';
import { type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import createDevRunner from '../lib/dev-runner.ts';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly killSignals: NodeJS.Signals[] = [];
  readonly killed = deferred<NodeJS.Signals>();

  constructor(private readonly ignoreSigterm = false) {
    super();
  }

  finish(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }

  kill(signal: NodeJS.Signals): boolean {
    this.killSignals.push(signal);
    this.killed.resolve(signal);
    if (this.ignoreSigterm && signal === 'SIGTERM') return true;
    queueMicrotask(() => this.finish(null, signal));
    return true;
  }
}

const asChildProcess = (child: FakeChild): ChildProcess => child as unknown as ChildProcess;

describe('lib/dev-runner', () => {
  it('should debounce builds and restart only after a successful build', async () => {
    const firstBuildStarted = deferred<FakeChild>();
    const secondBuildStarted = deferred<FakeChild>();
    const firstGatewayStarted = deferred<FakeChild>();
    const secondGatewayStarted = deferred<FakeChild>();
    let builds = 0;
    let gateways = 0;
    const runner = createDevRunner({
      debounceMs: 0,
      startBuild: () => {
        const child = new FakeChild();
        builds += 1;
        (builds === 1 ? firstBuildStarted : secondBuildStarted).resolve(child);
        return asChildProcess(child);
      },
      startGateway: () => {
        const child = new FakeChild();
        gateways += 1;
        (gateways === 1 ? firstGatewayStarted : secondGatewayStarted).resolve(child);
        return asChildProcess(child);
      },
    });

    runner.requestBuild();
    runner.requestBuild();
    const firstBuild = await firstBuildStarted.promise;
    assert.equal(builds, 1);
    firstBuild.finish(0);
    const firstGateway = await firstGatewayStarted.promise;

    runner.requestBuild();
    const secondBuild = await secondBuildStarted.promise;
    secondBuild.finish(0);
    await secondGatewayStarted.promise;

    assert.equal(builds, 2);
    assert.equal(gateways, 2);
    assert.deepEqual(firstGateway.killSignals, ['SIGTERM']);
    await runner.stop();
  });

  it('should keep the current Gateway alive when a build fails', async () => {
    const firstBuildStarted = deferred<FakeChild>();
    const secondBuildStarted = deferred<FakeChild>();
    const gatewayStarted = deferred<FakeChild>();
    const buildFailed = deferred<unknown>();
    let builds = 0;
    const runner = createDevRunner({
      debounceMs: 0,
      startBuild: () => {
        const child = new FakeChild();
        builds += 1;
        (builds === 1 ? firstBuildStarted : secondBuildStarted).resolve(child);
        return asChildProcess(child);
      },
      startGateway: () => {
        const child = new FakeChild();
        gatewayStarted.resolve(child);
        return asChildProcess(child);
      },
      onBuildError: (error) => buildFailed.resolve(error),
    });

    runner.requestBuild();
    const firstBuild = await firstBuildStarted.promise;
    firstBuild.finish(0);
    const gateway = await gatewayStarted.promise;

    runner.requestBuild();
    const secondBuild = await secondBuildStarted.promise;
    secondBuild.finish(1);
    const error = await buildFailed.promise;

    assert.match(String(error), /build failed with exit 1/);
    assert.deepEqual(gateway.killSignals, []);
    await runner.stop();
  });

  it('should cancel a stale build and coalesce pending rebuilds', async () => {
    const firstBuildStarted = deferred<FakeChild>();
    const secondBuildStarted = deferred<FakeChild>();
    const gatewayStarted = deferred<FakeChild>();
    let builds = 0;
    const runner = createDevRunner({
      debounceMs: 0,
      startBuild: () => {
        const child = new FakeChild();
        builds += 1;
        (builds === 1 ? firstBuildStarted : secondBuildStarted).resolve(child);
        return asChildProcess(child);
      },
      startGateway: () => {
        const child = new FakeChild();
        gatewayStarted.resolve(child);
        return asChildProcess(child);
      },
    });

    runner.requestBuild();
    const firstBuild = await firstBuildStarted.promise;
    runner.requestBuild();
    runner.requestBuild();
    assert.equal(await firstBuild.killed.promise, 'SIGTERM');

    const secondBuild = await secondBuildStarted.promise;
    secondBuild.finish(0);
    await gatewayStarted.promise;

    assert.equal(builds, 2);
    await runner.stop();
  });

  it('should cancel an active build during shutdown', async () => {
    const buildStarted = deferred<FakeChild>();
    let gateways = 0;
    const runner = createDevRunner({
      debounceMs: 0,
      startBuild: () => {
        const child = new FakeChild();
        buildStarted.resolve(child);
        return asChildProcess(child);
      },
      startGateway: () => {
        gateways += 1;
        return asChildProcess(new FakeChild());
      },
    });

    runner.requestBuild();
    const build = await buildStarted.promise;
    const stopping = runner.stop();
    assert.equal(await build.killed.promise, 'SIGTERM');
    await stopping;

    assert.equal(gateways, 0);
  });

  it('should force-stop a Gateway that does not exit after SIGTERM', async () => {
    const buildStarted = deferred<FakeChild>();
    const gatewayStarted = deferred<FakeChild>();
    const runner = createDevRunner({
      debounceMs: 0,
      shutdownTimeoutMs: 1,
      startBuild: () => {
        const child = new FakeChild();
        buildStarted.resolve(child);
        return asChildProcess(child);
      },
      startGateway: () => {
        const child = new FakeChild(true);
        gatewayStarted.resolve(child);
        return asChildProcess(child);
      },
    });

    runner.requestBuild();
    const build = await buildStarted.promise;
    build.finish(0);
    const gateway = await gatewayStarted.promise;
    await runner.stop();

    assert.deepEqual(gateway.killSignals, ['SIGTERM', 'SIGKILL']);
  });
});
