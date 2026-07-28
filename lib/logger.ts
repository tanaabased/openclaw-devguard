import { formatErrorMessage } from 'openclaw/plugin-sdk/error-runtime';

export interface Logger {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

const reportedErrors = new WeakSet<object>();

function prefix(message: string): string {
  return `[devguard] ${message}`;
}

export function logDebug(logger: Logger, message: string): void {
  logger.debug?.(prefix(message));
}

export function logInfo(logger: Logger, message: string): void {
  logger.info(prefix(message));
}

export function reportError(logger: Logger, context: string, error: unknown): string {
  const message = formatErrorMessage(error);
  if (typeof error === 'object' && error !== null) {
    if (reportedErrors.has(error)) return message;
    reportedErrors.add(error);
  }
  logger.error(prefix(`${context}: ${message}`));
  return message;
}
