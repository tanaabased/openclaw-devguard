import assert from 'node:assert/strict';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import createToolGuard from '../lib/tool-guard.ts';
import { createExecProbeResult, EXEC_PROBE_RESULT_PREFIX } from '../utils/exec-probe.ts';

describe('lib/tool-guard', () => {
  it('should create private tool-call audit logs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-tool-guard-'));
    const logPath = join(root, 'logs', 'events.jsonl');

    try {
      const guard = createToolGuard({
        pluginId: 'openclaw-devguard',
        buildId: 'build-123',
        logPath,
        policyMode: 'deny',
      });
      await guard.captureToolCall(
        { toolName: 'exec', params: {}, toolCallId: 'call-private' },
        { toolName: 'exec' },
      );

      assert.equal((await lstat(dirname(logPath))).mode & 0o777, 0o700);
      assert.equal((await lstat(logPath)).mode & 0o777, 0o600);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('should capture and replace exec with a correlated non-mutating probe', async () => {
    const writes: object[][] = [];
    const guard = createToolGuard({
      pluginId: 'openclaw-devguard',
      buildId: 'build-123',
      logPath: '/tmp/devguard-test.jsonl',
      policyMode: 'probe',
      probeExecutablePath: '/usr/bin/node',
      probeScriptPath: '/plugin/dist/exec-probe-task.js',
      createProbeId: () => 'probe-123',
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

    await guard.captureToolCall(event, context);
    const decision = await guard.applyToolPolicy(event, context);

    assert.ok('params' in decision);
    assert.equal(decision.params.host, 'gateway');
    assert.equal(decision.params.background, false);
    assert.deepEqual(decision.params.env, {});
    assert.match(String(decision.params.command), /exec-probe-task\.js/);
    assert.doesNotMatch(String(decision.params.command), /touch sentinel/);

    const probeResult = createExecProbeResult('probe-123', ['NODE_ENV', 'API_TOKEN'], {
      NODE_ENV: 'test',
      API_TOKEN: 'hidden',
    });
    await guard.recordToolResult(
      {
        toolName: 'exec',
        params: decision.params,
        runId: 'run-1',
        toolCallId: 'call-1',
        result: {
          content: [{ text: `${EXEC_PROBE_RESULT_PREFIX}${JSON.stringify(probeResult)}` }],
        },
        durationMs: 4,
      },
      context,
    );

    assert.equal(writes.length, 3);
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
    assert.equal((writes[1]?.[0] as { event: string }).event, 'tool_call_probed');
    const completed = writes[2]?.[0] as {
      event: string;
      originalCommandExecuted: boolean;
      environment: Array<{ name: string; redacted?: boolean; sha256?: string }>;
    };
    assert.equal(completed.event, 'tool_call_probe_completed');
    assert.equal(completed.originalCommandExecuted, false);
    assert.ok(
      completed.environment.some(({ name, redacted }) => name === 'API_TOKEN' && redacted === true),
    );
    assert.ok(
      completed.environment.some(({ name, sha256 }) => name === 'NODE_ENV' && Boolean(sha256)),
    );
    assert.equal(guard.status().policyMode, 'probe');
    assert.equal(guard.status().profileName, 'devguard-example');
    assert.match(guard.buildPromptContext()?.appendSystemContext ?? '', /not executed/);
  });

  it('should block tools that do not have a probe implementation', async () => {
    const guard = createToolGuard({
      pluginId: 'openclaw-devguard',
      buildId: 'build-123',
      logPath: '/tmp/devguard-test.jsonl',
      policyMode: 'probe',
      probeExecutablePath: '/usr/bin/node',
      probeScriptPath: '/plugin/dist/exec-probe-task.js',
      append: async () => {},
    });

    const result = await guard.applyToolPolicy(
      { toolName: 'write', params: {}, toolCallId: 'call-2' },
      { toolName: 'write' },
    );

    assert.ok('block' in result);
    assert.match(result.blockReason, /without a non-mutating probe/);
  });

  it('should retain explicit deny mode', async () => {
    const guard = createToolGuard({
      pluginId: 'openclaw-devguard',
      buildId: 'build-123',
      logPath: '/tmp/devguard-test.jsonl',
      policyMode: 'deny',
      append: async () => {},
    });

    const result = await guard.applyToolPolicy(
      { toolName: 'exec', params: {}, toolCallId: 'call-3' },
      { toolName: 'exec' },
    );

    assert.ok('block' in result);
    assert.match(result.blockReason, /deny mode/);
    assert.equal(guard.buildPromptContext(), undefined);
  });

  it('should remain fail-closed when the append-only log cannot be written', async () => {
    let loggedError: unknown;
    const guard = createToolGuard({
      pluginId: 'openclaw-devguard',
      buildId: 'build-123',
      logPath: '/unwritable/events.jsonl',
      policyMode: 'probe',
      probeExecutablePath: '/usr/bin/node',
      probeScriptPath: '/plugin/dist/exec-probe-task.js',
      append: async () => {
        throw new Error('disk unavailable');
      },
      onLogError: (error) => {
        loggedError = error;
      },
    });

    const event = { toolName: 'exec', params: {}, toolCallId: 'call-4' };
    const context = { toolName: 'exec' };

    await guard.captureToolCall(event, context);
    const result = await guard.applyToolPolicy(event, context);

    assert.ok('block' in result);
    assert.match(result.blockReason, /logging failed/i);
    assert.match(String(loggedError), /disk unavailable/);
  });
});
