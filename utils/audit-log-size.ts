import { stat } from 'node:fs/promises';

import { type Logger, logWarn } from '../lib/logger.ts';

const MEBIBYTE_BYTES = 1024 * 1024;

export const AUDIT_LOG_SIZE_WARNING_BYTES = 100 * MEBIBYTE_BYTES;

interface AuditLogStat {
  size: number;
}

export interface WarnIfAuditLogLargeOptions {
  logPath: string;
  logger: Logger;
  statFile?: (path: string) => Promise<AuditLogStat>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Warns about oversized or unreadable audit logs without interrupting the caller.
 * A missing log is normal because DevGuard may not have recorded its first event yet.
 */
export default async function warnIfAuditLogLarge(
  options: WarnIfAuditLogLargeOptions,
): Promise<void> {
  const statFile = options.statFile ?? stat;
  let size: number;

  try {
    size = (await statFile(options.logPath)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    logWarn(
      options.logger,
      `could not inspect audit log size at ${options.logPath}: ${errorMessage(error)}`,
    );
    return;
  }

  if (size < AUDIT_LOG_SIZE_WARNING_BYTES) return;

  const sizeMiB = Math.ceil(size / MEBIBYTE_BYTES);
  logWarn(
    options.logger,
    `audit log is ${sizeMiB} MiB at ${options.logPath}; stop any active openclaw devguard run, then archive or remove the file if you no longer need its history`,
  );
}
