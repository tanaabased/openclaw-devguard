import assert from 'node:assert/strict';

import {
  assertBlockedResult,
  assertDenyLogContents,
  assertRestartEvents,
  formatLogTail,
} from '../scripts/leia-check-cli.mjs';

const toolNames = ['exec', 'write', 'totally-unknown-tool'];

function denyLogContents(): string {
  const attempted = toolNames.map((toolName) => ({
    agentId: 'leia-agent',
    environment: {
      toolArguments: [{ name: 'DEVGUARD_TEST_SECRET', redacted: true }],
    },
    event: 'tool_call_attempted',
    pluginBuildId: 'build-1',
    pluginId: 'devguard-example',
    runId: 'leia-run',
    sessionKey: 'agent:leia:main',
    toolCallId: `call-${toolName}`,
    toolName,
  }));
  const blocked = toolNames.map((toolName) => ({
    decision: 'blocked',
    event: 'tool_call_blocked',
    toolName,
  }));
  return [...attempted, ...blocked].map((event) => JSON.stringify(event)).join('\n');
}

function restartEvents(): Array<Record<string, unknown>> {
  return [
    { event: 'build_succeeded', pluginBuildId: 'build-1' },
    { event: 'target_plugin_loaded', pluginBuildId: 'build-1' },
    { event: 'gateway_restart_requested' },
    { event: 'build_succeeded', pluginBuildId: 'build-2' },
    { event: 'target_plugin_loaded', pluginBuildId: 'build-2' },
  ];
}

describe('scripts/leia-check-cli', () => {
  it('should recognize only terminal blocked tool outcomes', () => {
    assert.doesNotThrow(() => assertBlockedResult({ blocked: true, kind: 'veto' }));
    assert.throws(
      () => assertBlockedResult({ blocked: false, kind: 'veto' }),
      /terminal blocked tool outcome/,
    );
  });

  it('should enforce the deny log safety and correlation contract', () => {
    const contents = denyLogContents();
    assert.doesNotThrow(() => assertDenyLogContents(contents));
    assert.throws(
      () => assertDenyLogContents(contents.replace('"redacted":true', '"redacted":false')),
      /did not mark.*secret as redacted/,
    );
    assert.throws(
      () => assertDenyLogContents(`${contents}\n{"value":"leia-sensitive-value"}`),
      /exposed.*secret/,
    );
  });

  it('should require two verified restart lifecycles without failures', () => {
    const events = restartEvents();
    assert.doesNotThrow(() => assertRestartEvents(events));
    assert.throws(
      () => assertRestartEvents([...events, { event: 'gateway_start_failed' }]),
      /contained 1 failure/,
    );
  });

  it('should bound failure logs while preserving the newest output', () => {
    const lines = [
      'omitted-start-marker',
      ...Array.from({ length: 120 }, (_, index) => `line-${index + 2}`),
    ];
    const output = formatLogTail(lines.join('\n'));

    assert.match(output, /last 120 log lines/);
    assert.doesNotMatch(output, /omitted-start-marker/);
    assert.match(output, /line-121/);
    assert.equal(formatLogTail(''), '\n\nlog was empty');
  });
});
