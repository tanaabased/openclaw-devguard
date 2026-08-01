import { createExecProbeResult, EXEC_PROBE_RESULT_PREFIX } from '../utils/exec-probe.ts';

const [probeId, ...environmentNames] = process.argv.slice(2);

if (!probeId) {
  process.stderr.write('devguard exec probe requires a probe id\n');
  process.exitCode = 1;
} else {
  const result = createExecProbeResult(probeId, environmentNames, process.env);
  process.stdout.write(
    [
      'devguard exec probe completed',
      'original command executed: no',
      `${EXEC_PROBE_RESULT_PREFIX}${JSON.stringify(result)}`,
      '',
    ].join('\n'),
  );
}
