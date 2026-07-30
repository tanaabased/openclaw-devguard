import assert from 'node:assert/strict';
import { type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import createDevRunner, { type DevRunnerOptions, type GatewayExit } from '../lib/dev-runner.ts';
import { type OwnedProcessCleanupError, OwnedProcessTimeoutError } from '../lib/owned-process.ts';

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
  readonly pid = 42;

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

const stopFakeProcess: NonNullable<DevRunnerOptions['stopProcess']> = async (child, options) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return {
      outcome: 'already-exited',
      phase: options.phase,
      pid: child.pid,
      signals: [],
    };
  }

  child.kill('SIGTERM');
  await Promise.resolve();
  if (child.exitCode !== null || child.signalCode !== null) {
    return {
      outcome: 'terminated',
      phase: options.phase,
      pid: child.pid,
      signals: ['SIGTERM'],
    };
  }

  child.kill('SIGKILL');
  await Promise.resolve();
  return {
    outcome: child.exitCode !== null || child.signalCode !== null ? 'killed' : 'incomplete',
    phase: options.phase,
    pid: child.pid,
    signals: ['SIGTERM', 'SIGKILL'],
  };
};

function createTestRunner(options: DevRunnerOptions) {
  return createDevRunner({ stopProcess: stopFakeProcess, ...options });
}

function controlledDeadlines() {
  const deadlines: Deferred<void>[] = [];
  return {
    createDeadline: () => {
      const deadline = deferred<void>();
      deadlines.push(deadline);
      return { cancel() {}, elapsed: deadline.promise };
    },
    deadlines,
  };
}

describe('lib/dev-runner', () => {
  it('should debounce builds and restart only after a successful build', async () => {
    const firstBuildStarted = deferred<FakeChild>();
    const secondBuildStarted = deferred<FakeChild>();
    const firstGatewayStarted = deferred<FakeChild>();
    const secondGatewayStarted = deferred<FakeChild>();
    let builds = 0;
    let gateways = 0;
    let restartRequests = 0;
    const gatewayExits: GatewayExit[] = [];
    const runner = createTestRunner({
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
      onGatewayExit: (exit) => gatewayExits.push(exit),
      onGatewayRestartRequested: () => {
        restartRequests += 1;
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
    assert.equal(restartRequests, 1);
    assert.deepEqual(firstGateway.killSignals, ['SIGTERM']);
    await runner.stop();
    assert.deepEqual(gatewayExits, []);
  });

  it('should keep the current Gateway alive when a build fails', async () => {
    const firstBuildStarted = deferred<FakeChild>();
    const secondBuildStarted = deferred<FakeChild>();
    const gatewayStarted = deferred<FakeChild>();
    const buildFailed = deferred<unknown>();
    let builds = 0;
    const runner = createTestRunner({
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

  it('should validate a build before starting the Gateway', async () => {
    const buildStarted = deferred<FakeChild>();
    const validationStarted = deferred<FakeChild>();
    const gatewayStarted = deferred<FakeChild>();
    let buildsSucceeded = 0;
    const runner = createTestRunner({
      debounceMs: 0,
      startBuild: () => {
        const child = new FakeChild();
        buildStarted.resolve(child);
        return asChildProcess(child);
      },
      startValidation: () => {
        const child = new FakeChild();
        validationStarted.resolve(child);
        return asChildProcess(child);
      },
      startGateway: () => {
        const child = new FakeChild();
        gatewayStarted.resolve(child);
        return asChildProcess(child);
      },
      onBuildSucceeded: () => {
        buildsSucceeded += 1;
      },
    });

    runner.requestBuild();
    const build = await buildStarted.promise;
    build.finish(0);
    const validation = await validationStarted.promise;
    assert.equal(buildsSucceeded, 0);
    validation.finish(0);
    await gatewayStarted.promise;

    assert.equal(buildsSucceeded, 1);
    await runner.stop();
  });

  it('should keep the current Gateway alive when validation fails', async () => {
    const firstBuildStarted = deferred<FakeChild>();
    const secondBuildStarted = deferred<FakeChild>();
    const firstValidationStarted = deferred<FakeChild>();
    const secondValidationStarted = deferred<FakeChild>();
    const gatewayStarted = deferred<FakeChild>();
    const validationFailed = deferred<unknown>();
    let builds = 0;
    let validations = 0;
    let gateways = 0;
    const runner = createTestRunner({
      debounceMs: 0,
      startBuild: () => {
        const child = new FakeChild();
        builds += 1;
        (builds === 1 ? firstBuildStarted : secondBuildStarted).resolve(child);
        return asChildProcess(child);
      },
      startValidation: () => {
        const child = new FakeChild();
        validations += 1;
        (validations === 1 ? firstValidationStarted : secondValidationStarted).resolve(child);
        return asChildProcess(child);
      },
      startGateway: () => {
        const child = new FakeChild();
        gateways += 1;
        gatewayStarted.resolve(child);
        return asChildProcess(child);
      },
      onValidationError: (error) => validationFailed.resolve(error),
    });

    runner.requestBuild();
    const firstBuild = await firstBuildStarted.promise;
    firstBuild.finish(0);
    const firstValidation = await firstValidationStarted.promise;
    firstValidation.finish(0);
    const gateway = await gatewayStarted.promise;

    runner.requestBuild();
    const secondBuild = await secondBuildStarted.promise;
    secondBuild.finish(0);
    const secondValidation = await secondValidationStarted.promise;
    secondValidation.finish(1);
    const error = await validationFailed.promise;

    assert.match(String(error), /validation failed with exit 1/);
    assert.equal(gateways, 1);
    assert.deepEqual(gateway.killSignals, []);
    await runner.stop();
  });

  it('should cancel a stale build and coalesce pending rebuilds', async () => {
    const firstBuildStarted = deferred<FakeChild>();
    const secondBuildStarted = deferred<FakeChild>();
    const gatewayStarted = deferred<FakeChild>();
    let builds = 0;
    const runner = createTestRunner({
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
    const runner = createTestRunner({
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

  it('should bound a build and report its completed cleanup', async () => {
    const buildStarted = deferred<FakeChild>();
    const buildFailed = deferred<unknown>();
    const deadlines = controlledDeadlines();
    let gateways = 0;
    const runner = createTestRunner({
      buildTimeoutMs: 2_000,
      createDeadline: deadlines.createDeadline,
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
      onBuildError: (error) => buildFailed.resolve(error),
    });

    runner.requestBuild();
    const build = await buildStarted.promise;
    deadlines.deadlines[0]?.resolve();
    const error = await buildFailed.promise;

    assert.ok(error instanceof OwnedProcessTimeoutError);
    assert.equal(error.cleanup.outcome, 'terminated');
    assert.deepEqual(build.killSignals, ['SIGTERM']);
    assert.equal(gateways, 0);
    await runner.stop();
  });

  it('should preserve the current Gateway after a replacement validation timeout', async () => {
    const firstBuildStarted = deferred<FakeChild>();
    const secondBuildStarted = deferred<FakeChild>();
    const firstValidationStarted = deferred<FakeChild>();
    const secondValidationStarted = deferred<FakeChild>();
    const gatewayStarted = deferred<FakeChild>();
    const validationFailed = deferred<unknown>();
    const deadlines = controlledDeadlines();
    let builds = 0;
    let validations = 0;
    let gateways = 0;
    const runner = createTestRunner({
      createDeadline: deadlines.createDeadline,
      debounceMs: 0,
      startBuild: () => {
        const child = new FakeChild();
        builds += 1;
        (builds === 1 ? firstBuildStarted : secondBuildStarted).resolve(child);
        return asChildProcess(child);
      },
      startValidation: () => {
        const child = new FakeChild();
        validations += 1;
        (validations === 1 ? firstValidationStarted : secondValidationStarted).resolve(child);
        return asChildProcess(child);
      },
      startGateway: () => {
        const child = new FakeChild();
        gateways += 1;
        gatewayStarted.resolve(child);
        return asChildProcess(child);
      },
      onValidationError: (error) => validationFailed.resolve(error),
    });

    runner.requestBuild();
    (await firstBuildStarted.promise).finish(0);
    (await firstValidationStarted.promise).finish(0);
    const gateway = await gatewayStarted.promise;

    runner.requestBuild();
    (await secondBuildStarted.promise).finish(0);
    const validation = await secondValidationStarted.promise;
    deadlines.deadlines[3]?.resolve();
    const error = await validationFailed.promise;

    assert.ok(error instanceof OwnedProcessTimeoutError);
    assert.equal(error.phase, 'validation');
    assert.deepEqual(validation.killSignals, ['SIGTERM']);
    assert.equal(gateways, 1);
    assert.deepEqual(gateway.killSignals, []);
    await runner.stop();
  });

  it('should halt supervision when process cleanup cannot be verified', async () => {
    const buildStarted = deferred<FakeChild>();
    const cleanupFailed = deferred<OwnedProcessCleanupError>();
    const deadlines = controlledDeadlines();
    let buildErrors = 0;
    let gateways = 0;
    const runner = createTestRunner({
      createDeadline: deadlines.createDeadline,
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
      stopProcess: async (_child, options) => ({
        detail: 'process group remained active after SIGKILL',
        outcome: 'incomplete',
        phase: options.phase,
        pid: 42,
        signals: ['SIGTERM', 'SIGKILL'],
      }),
      onBuildError: () => {
        buildErrors += 1;
      },
      onCleanupIncomplete: (error) => cleanupFailed.resolve(error),
    });

    runner.requestBuild();
    await buildStarted.promise;
    deadlines.deadlines[0]?.resolve();
    const error = await cleanupFailed.promise;

    assert.match(error.message, /pid 42.*terminate it manually/);
    assert.equal(buildErrors, 0);
    assert.equal(gateways, 0);
    await runner.stop();
  });

  it('should force-stop a Gateway that does not exit after SIGTERM', async () => {
    const buildStarted = deferred<FakeChild>();
    const gatewayStarted = deferred<FakeChild>();
    const runner = createTestRunner({
      debounceMs: 0,
      shutdownGraceMs: 1,
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

  it('should report an unexpected Gateway exit once', async () => {
    const buildStarted = deferred<FakeChild>();
    const gatewayStarted = deferred<FakeChild>();
    const gatewayExited = deferred<void>();
    const gatewayExits: GatewayExit[] = [];
    const runner = createTestRunner({
      debounceMs: 0,
      startBuild: () => {
        const child = new FakeChild();
        buildStarted.resolve(child);
        return asChildProcess(child);
      },
      startGateway: () => {
        const child = new FakeChild();
        gatewayStarted.resolve(child);
        return asChildProcess(child);
      },
      onGatewayExit: (exit) => {
        gatewayExits.push(exit);
        gatewayExited.resolve();
      },
    });

    runner.requestBuild();
    const build = await buildStarted.promise;
    build.finish(0);
    const gateway = await gatewayStarted.promise;
    gateway.finish(17);
    gateway.finish(18);
    await gatewayExited.promise;

    assert.deepEqual(gatewayExits, [{ code: 17, signal: null }]);
    await runner.stop();
    assert.deepEqual(gateway.killSignals, []);
  });

  it('should report an unexpected Gateway process error', async () => {
    const buildStarted = deferred<FakeChild>();
    const gatewayStarted = deferred<FakeChild>();
    const gatewayExited = deferred<GatewayExit>();
    const runner = createTestRunner({
      debounceMs: 0,
      startBuild: () => {
        const child = new FakeChild();
        buildStarted.resolve(child);
        return asChildProcess(child);
      },
      startGateway: () => {
        const child = new FakeChild();
        gatewayStarted.resolve(child);
        return asChildProcess(child);
      },
      onGatewayExit: (exit) => gatewayExited.resolve(exit),
    });

    runner.requestBuild();
    const build = await buildStarted.promise;
    build.finish(0);
    const gateway = await gatewayStarted.promise;
    const error = new Error('spawn failure');
    gateway.emit('error', error);

    assert.deepEqual(await gatewayExited.promise, { code: null, signal: null, error });
    await runner.stop();
    assert.deepEqual(gateway.killSignals, ['SIGTERM']);
  });
});
