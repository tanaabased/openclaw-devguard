import assert from 'node:assert/strict';

import { type Logger } from '../lib/logger.ts';
import warnIfAuditLogLarge, { AUDIT_LOG_SIZE_WARNING_BYTES } from '../utils/audit-log-size.ts';

function captureWarnings(): { logger: Logger; warnings: string[] } {
  const warnings: string[] = [];
  return {
    logger: {
      info() {},
      warn: (message) => warnings.push(message),
      error() {},
    },
    warnings,
  };
}

describe('utils/audit-log-size', () => {
  it('should ignore a missing audit log', async () => {
    const { logger, warnings } = captureWarnings();
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });

    await warnIfAuditLogLarge({
      logPath: '/tmp/events.jsonl',
      logger,
      statFile: async () => Promise.reject(missing),
    });

    assert.deepEqual(warnings, []);
  });

  it('should ignore an audit log below the warning threshold', async () => {
    const { logger, warnings } = captureWarnings();

    await warnIfAuditLogLarge({
      logPath: '/tmp/events.jsonl',
      logger,
      statFile: async () => ({ size: AUDIT_LOG_SIZE_WARNING_BYTES - 1 }),
    });

    assert.deepEqual(warnings, []);
  });

  it('should warn when an audit log reaches the warning threshold', async () => {
    const { logger, warnings } = captureWarnings();

    await warnIfAuditLogLarge({
      logPath: '/tmp/events.jsonl',
      logger,
      statFile: async () => ({ size: AUDIT_LOG_SIZE_WARNING_BYTES }),
    });

    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /audit log is 100 MiB/);
    assert.match(warnings[0] ?? '', /\/tmp\/events\.jsonl/);
    assert.match(warnings[0] ?? '', /stop any active openclaw devguard run/);
    assert.match(warnings[0] ?? '', /archive or remove the file/);
  });

  it('should warn without failing when audit log inspection fails', async () => {
    const { logger, warnings } = captureWarnings();

    await warnIfAuditLogLarge({
      logPath: '/tmp/events.jsonl',
      logger,
      statFile: async () => Promise.reject(new Error('permission denied')),
    });

    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /could not inspect audit log size/);
    assert.match(warnings[0] ?? '', /permission denied/);
  });
});
