import assert from 'node:assert/strict';

import createToolGuard from '../lib/tool-guard.ts';

describe('lib/tool-guard', () => {
  it('should capture a redacted attempt before terminally blocking every tool', async () => {
    const writes: object[][] = [];
    const guard = createToolGuard({
      pluginId: 'openclaw-devguard',
      buildId: 'build-123',
      logPath: '/tmp/devguard-test.jsonl',
      environment: {
        NODE_ENV: 'development',
        API_TOKEN: 'secret',
        OPENCLAW_PROFILE: 'devguard-example',
      },
      environmentValueAllowlist: ['NODE_ENV', 'API_TOKEN'],
      now: () => new Date('2026-07-28T12:00:00.000Z'),
      append: async (_path, records) => {
        writes.push([...records]);
      },
    });

    const event = {
      toolName: 'exec',
      params: { command: 'touch sentinel', env: { NODE_ENV: 'test', API_TOKEN: 'hidden' } },
      runId: 'run-1',
      toolCallId: 'call-1',
    };
    const context = { toolName: 'exec', agentId: 'dev' };

    const captureResult = await guard.captureToolCall(event, context);
    const result = await guard.blockToolCall(event, context);

    assert.equal(captureResult, undefined);
    assert.equal(result.block, true);
    assert.match(result.blockReason, /deny mode/);
    assert.equal(writes.length, 2);
    const attempt = writes[0]?.[0] as {
      event: string;
      params: unknown;
      environment: {
        gatewayProcess: unknown;
        toolArguments: unknown;
        finalToolProcessEnvironmentComplete: boolean;
      };
    };
    assert.equal(attempt.event, 'tool_call_attempted');
    assert.deepEqual(attempt.params, {
      command: 'touch sentinel',
      env: '[captured separately]',
    });
    assert.deepEqual(attempt.environment.gatewayProcess, [
      { name: 'API_TOKEN', present: true, length: 6, redacted: true },
      { name: 'NODE_ENV', present: true, length: 11, preview: 'de…nt' },
      { name: 'OPENCLAW_PROFILE', present: true, length: 16 },
    ]);
    assert.deepEqual(attempt.environment.toolArguments, [
      { name: 'API_TOKEN', present: true, length: 6, redacted: true },
      { name: 'NODE_ENV', present: true, length: 4, preview: 't…t' },
    ]);
    assert.equal(attempt.environment.finalToolProcessEnvironmentComplete, false);
    assert.equal((writes[1]?.[0] as { event: string }).event, 'tool_call_blocked');
    assert.equal(guard.status().ambientChannelsDisabled, false);
    assert.equal(guard.status().profileName, 'devguard-example');
  });

  it('should remain fail-closed when the append-only log cannot be written', async () => {
    let loggedError: unknown;
    const guard = createToolGuard({
      pluginId: 'openclaw-devguard',
      buildId: 'build-123',
      logPath: '/unwritable/events.jsonl',
      append: async () => {
        throw new Error('disk unavailable');
      },
      onLogError: (error) => {
        loggedError = error;
      },
    });

    const event = { toolName: 'unknown_tool', params: {} };
    const context = { toolName: 'unknown_tool' };

    const captureResult = await guard.captureToolCall(event, context);
    const result = await guard.blockToolCall(event, context);

    assert.equal(captureResult, undefined);
    assert.equal(result.block, true);
    assert.match(result.blockReason, /logging failed/i);
    assert.match(String(loggedError), /disk unavailable/);
  });
});
