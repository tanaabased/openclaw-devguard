import assert from 'node:assert/strict';

import waitForGatewayStatus, {
  type GatewayStatus,
  GatewayStatusTimeoutError,
} from '../lib/gateway-status.ts';

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

function statusResult(pluginBuildId: string): GatewayStatus {
  return {
    denyUnknownTools: true,
    pluginBuildId,
    hookRegistered: true,
    policyMode: 'probe',
  };
}

describe('lib/gateway-status', () => {
  it('should keep polling when a previous Gateway build answers first', async () => {
    const results = [statusResult('build-1'), statusResult('build-2')];
    let queries = 0;

    const status = await waitForGatewayStatus({
      expectedBuildId: 'build-2',
      isCurrent: () => true,
      queryStatus: () => Promise.resolve(results[queries++]!),
      timeoutMs: 1_000,
      pollIntervalMs: 0,
    });

    assert.equal(status?.pluginBuildId, 'build-2');
    assert.equal(queries, 2);
  });

  it('should retry a transient Gateway connection failure', async () => {
    let queries = 0;
    const status = await waitForGatewayStatus({
      expectedBuildId: 'build-1',
      isCurrent: () => true,
      queryStatus: () => {
        queries += 1;
        if (queries === 1) return Promise.reject(new Error('connection refused'));
        return Promise.resolve(statusResult('build-1'));
      },
      timeoutMs: 1_000,
      pollIntervalMs: 0,
    });

    assert.equal(status?.pluginBuildId, 'build-1');
    assert.equal(queries, 2);
  });

  it('should retire a status probe superseded while its query is running', async () => {
    const queryStarted = deferred<void>();
    const queryResult = deferred<GatewayStatus>();
    let current = true;
    const statusPromise = waitForGatewayStatus({
      expectedBuildId: 'build-1',
      isCurrent: () => current,
      queryStatus: () => {
        queryStarted.resolve();
        return queryResult.promise;
      },
      timeoutMs: 1_000,
      pollIntervalMs: 0,
    });

    await queryStarted.promise;
    current = false;
    queryResult.resolve(statusResult('build-2'));

    assert.equal(await statusPromise, undefined);
  });

  it('should report timeout data without relying on wall-clock timing', async () => {
    let currentTime = 0;

    await assert.rejects(
      waitForGatewayStatus({
        delay: (milliseconds) => {
          currentTime += milliseconds;
          return Promise.resolve();
        },
        expectedBuildId: 'build-2',
        isCurrent: () => true,
        now: () => currentTime,
        queryStatus: () => Promise.resolve(statusResult('build-1')),
        timeoutMs: 10,
        pollIntervalMs: 5,
      }),
      (error: unknown) => {
        assert.ok(error instanceof GatewayStatusTimeoutError);
        assert.equal(error.expectedBuildId, 'build-2');
        assert.equal(error.lastObservedBuildId, 'build-1');
        assert.equal(error.timeoutMs, 10);
        return true;
      },
    );
  });

  it('should reject a matching build without the safety hook', async () => {
    await assert.rejects(
      waitForGatewayStatus({
        expectedBuildId: 'build-1',
        isCurrent: () => true,
        queryStatus: () => Promise.resolve({ ...statusResult('build-1'), hookRegistered: false }),
        timeoutMs: 1_000,
      }),
      /DevGuard hook/,
    );
  });

  it('should reject a matching build with the wrong policy mode', async () => {
    await assert.rejects(
      waitForGatewayStatus({
        expectedBuildId: 'build-1',
        expectedPolicyMode: 'deny',
        isCurrent: () => true,
        queryStatus: () => Promise.resolve(statusResult('build-1')),
        timeoutMs: 1_000,
      }),
      /deny mode/,
    );
  });

  it('should reject a matching build that allows unknown tools', async () => {
    await assert.rejects(
      waitForGatewayStatus({
        expectedBuildId: 'build-1',
        isCurrent: () => true,
        queryStatus: () => Promise.resolve({ ...statusResult('build-1'), denyUnknownTools: false }),
        timeoutMs: 1_000,
      }),
      /unknown tools/,
    );
  });

  it('should reject a matching build from another profile or state directory', async () => {
    await assert.rejects(
      waitForGatewayStatus({
        expectedBuildId: 'build-1',
        expectedProfileName: 'devguard-example',
        expectedStateDirectory: '/home/tester/.openclaw-devguard-example',
        isCurrent: () => true,
        queryStatus: () =>
          Promise.resolve({
            ...statusResult('build-1'),
            profileName: 'wrong-profile',
            stateDirectory: '/home/tester/.openclaw-wrong-profile',
          }),
        timeoutMs: 1_000,
      }),
      /expected OpenClaw profile/,
    );
    await assert.rejects(
      waitForGatewayStatus({
        expectedBuildId: 'build-1',
        expectedProfileName: 'devguard-example',
        expectedStateDirectory: '/home/tester/.openclaw-devguard-example',
        isCurrent: () => true,
        queryStatus: () =>
          Promise.resolve({
            ...statusResult('build-1'),
            profileName: 'devguard-example',
            stateDirectory: '/home/tester/.openclaw-wrong-profile',
          }),
        timeoutMs: 1_000,
      }),
      /expected OpenClaw state directory/,
    );
  });
});
