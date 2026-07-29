import assert from 'node:assert/strict';

import {
  buildExecProbeCommand,
  createExecProbeResult,
  EXEC_PROBE_RESULT_PREFIX,
  parseExecProbeResult,
} from '../utils/exec-probe.ts';

describe('utils/exec-probe', () => {
  it('should build a fixed shell-safe recorder command', () => {
    const command = buildExecProbeCommand({
      environmentNames: ['DEVGUARD_EXAMPLE_EXEC_ENV'],
      executablePath: "/path with/'node",
      probeId: 'probe-1',
      scriptPath: '/plugin/dist/exec-probe-task.js',
    });

    assert.match(command, /^'/);
    assert.match(command, /'"'"'/);
    assert.doesNotMatch(command, /original command/);
  });

  it('should hash allowlisted values and redact sensitive names', () => {
    const result = createExecProbeResult(
      'probe-1',
      ['DEVGUARD_EXAMPLE_EXEC_ENV', 'OPENAI_API_KEY', 'MISSING'],
      {
        DEVGUARD_EXAMPLE_EXEC_ENV: 'positronic',
        OPENAI_API_KEY: 'secret',
      },
    );

    assert.deepEqual(result.environment, [
      {
        name: 'DEVGUARD_EXAMPLE_EXEC_ENV',
        present: true,
        length: 10,
        preview: 'po…ic',
        sha256: '688fa5fa6ca96d63edcfb5b46d2cd00a6c519b281c45e2b6f0fda337c523229c',
      },
      { name: 'MISSING', present: false },
      { name: 'OPENAI_API_KEY', present: true, length: 6, redacted: true },
    ]);
  });

  it('should find a structured probe marker inside a nested tool result', () => {
    const result = createExecProbeResult('probe-1', [], {});
    assert.deepEqual(
      parseExecProbeResult({
        content: [
          { type: 'text', text: `header\n${EXEC_PROBE_RESULT_PREFIX}${JSON.stringify(result)}\n` },
        ],
      }),
      result,
    );
  });
});
