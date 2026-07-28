import assert from 'node:assert/strict';

import { logDebug, logInfo, type Logger, reportError } from '../lib/logger.ts';

describe('lib/logger', () => {
  it('should format and redact errors before sending them to the plugin logger', () => {
    const errors: string[] = [];
    const logger: Logger = {
      info() {},
      warn() {},
      error: (message) => errors.push(message),
    };

    const message = reportError(
      logger,
      'build failed',
      new Error('token=supersecret', { cause: new Error('nested failure') }),
    );

    assert.match(message, /token=\*\*\*/);
    assert.match(message, /nested failure/);
    assert.doesNotMatch(message, /supersecret/);
    assert.equal(errors.length, 1);
    assert.match(errors[0] ?? '', /^\[devguard\] build failed:/);
    assert.doesNotMatch(errors[0] ?? '', /supersecret/);
  });

  it('should prefix operational and optional debug messages', () => {
    const messages: string[] = [];
    const logger: Logger = {
      debug: (message) => messages.push(`debug:${message}`),
      info: (message) => messages.push(`info:${message}`),
      warn() {},
      error() {},
    };

    logDebug(logger, 'watch event change: src/index.ts');
    logInfo(logger, 'build succeeded');

    assert.deepEqual(messages, [
      'debug:[devguard] watch event change: src/index.ts',
      'info:[devguard] build succeeded',
    ]);
  });

  it('should report the same error object only once', () => {
    const errors: string[] = [];
    const logger: Logger = {
      info() {},
      warn() {},
      error: (message) => errors.push(message),
    };
    const error = new Error('failure');

    reportError(logger, 'build failed', error);
    reportError(logger, 'run failed', error);

    assert.deepEqual(errors, ['[devguard] build failed: failure']);
  });
});
