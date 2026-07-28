import assert from 'node:assert/strict';

import {
  extractToolEnvironment,
  isSensitiveName,
  maskedPreview,
  redactValue,
  summarizeEnvironment,
} from '../utils/log-redaction.ts';

describe('utils/log-redaction', () => {
  it('should preview only exact allowlisted non-sensitive values', () => {
    assert.deepEqual(
      summarizeEnvironment({ NODE_ENV: 'development', GH_TOKEN: 'secret-token', OTHER: 'hidden' }, [
        'NODE_ENV',
        'GH_TOKEN',
      ]),
      [
        { name: 'GH_TOKEN', present: true, length: 12, redacted: true },
        { name: 'NODE_ENV', present: true, length: 11, preview: 'de…nt' },
        { name: 'OTHER', present: true, length: 6 },
      ],
    );
    assert.equal(maskedPreview('dev'), 'd…v');
    assert.equal(isSensitiveName('apiKey'), true);
    assert.equal(isSensitiveName('monkey'), false);
  });

  it('should redact credential fields and capture tool environment separately', () => {
    const params = {
      command: 'printenv',
      apiKey: 'do-not-log',
      options: { env: { NODE_ENV: 'test', SECRET_VALUE: 'hidden' } },
    };

    assert.deepEqual(redactValue(params), {
      command: 'printenv',
      apiKey: '[redacted]',
      options: { env: '[captured separately]' },
    });
    assert.deepEqual(extractToolEnvironment(params), {
      NODE_ENV: 'test',
      SECRET_VALUE: 'hidden',
    });
  });
});
