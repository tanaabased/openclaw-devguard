import assert from 'node:assert/strict';

import createToolGuard from '../lib/tool-guard.ts';

describe('lib/tool-guard', () => {
  it('should record a redacted attempt and terminally block every tool', async () => {
    const writes: object[][] = [];
    const guard = createToolGuard({
      pluginId: 'openclaw-devguard',
      buildId: 'build-123',
      logPath: '/tmp/devguard-test.jsonl',
      environment: { NODE_ENV: 'development', API_TOKEN: 'secret' },
      environmentValueAllowlist: ['NODE_ENV', 'API_TOKEN'],
      now: () => new Date('2026-07-28T12:00:00.000Z'),
      append: async (_path, records) => {
        writes.push([...records]);
      },
    });

    const result = await guard.beforeToolCall(
      {
        toolName: 'exec',
        params: { command: 'touch sentinel', env: { NODE_ENV: 'test', API_TOKEN: 'hidden' } },
        runId: 'run-1',
        toolCallId: 'call-1',
      },
      { toolName: 'exec', agentId: 'dev' },
    );

    assert.equal(result.block, true);
    assert.match(result.blockReason, /deny mode/);
    assert.equal(writes.length, 1);
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
    ]);
    assert.deepEqual(attempt.environment.toolArguments, [
      { name: 'API_TOKEN', present: true, length: 6, redacted: true },
      { name: 'NODE_ENV', present: true, length: 4, preview: 't…t' },
    ]);
    assert.equal(attempt.environment.finalToolProcessEnvironmentComplete, false);
    assert.equal((writes[0]?.[1] as { event: string }).event, 'tool_call_blocked');
    assert.equal(guard.status().ambientChannelsDisabled, false);
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

    const result = await guard.beforeToolCall(
      { toolName: 'unknown_tool', params: {} },
      { toolName: 'unknown_tool' },
    );

    assert.equal(result.block, true);
    assert.match(result.blockReason, /logging failed/i);
    assert.match(String(loggedError), /disk unavailable/);
  });
});
