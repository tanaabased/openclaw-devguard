import assert from 'node:assert/strict';

import runDevguard from '../cli/run.ts';
import { type Logger } from '../lib/logger.ts';

const logger: Logger = { info() {}, warn() {}, error() {} };

describe('cli/run', () => {
  it('should reject an unsupported host before project discovery', async () => {
    await assert.rejects(
      runDevguard('/path/that/does/not/exist', { logger, platform: 'win32' }),
      /platform win32 is unsupported/,
    );
  });
});
