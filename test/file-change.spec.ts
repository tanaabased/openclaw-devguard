import assert from 'node:assert/strict';

import shouldReportFileChange, { type FileSignature } from '../utils/file-change.ts';

const original: FileSignature = { contentHash: 'content-a', statKey: 'stat-a' };

describe('utils/file-change', () => {
  it('should ignore initial discovery and metadata-only changes', () => {
    assert.equal(
      shouldReportFileChange({ event: 'add', initialized: false, next: original }),
      false,
    );
    assert.equal(
      shouldReportFileChange({
        event: 'change',
        initialized: true,
        previous: original,
        next: { contentHash: original.contentHash, statKey: 'stat-b' },
      }),
      false,
    );
  });

  it('should report additions and content changes after initialization', () => {
    assert.equal(shouldReportFileChange({ event: 'add', initialized: true, next: original }), true);
    assert.equal(
      shouldReportFileChange({
        event: 'change',
        initialized: true,
        previous: original,
        next: { contentHash: 'content-b', statKey: 'stat-b' },
      }),
      true,
    );
  });

  it('should report removal only for a tracked file', () => {
    assert.equal(
      shouldReportFileChange({ event: 'unlink', initialized: true, previous: original }),
      true,
    );
    assert.equal(shouldReportFileChange({ event: 'unlink', initialized: true }), false);
  });
});
