import assert from 'node:assert/strict';

import notImplemented from '../utils/not-implemented.ts';

describe('utils/not-implemented', () => {
  it('should throw a named error that does not imply the command works', () => {
    assert.throws(
      () => notImplemented('doctor'),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, 'DevguardNotImplementedError');
        assert.match(error.message, /openclaw devguard doctor/);
        assert.match(error.message, /not implemented/);
        return true;
      },
    );
  });
});
