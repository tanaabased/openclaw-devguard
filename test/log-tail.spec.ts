import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import tailLogFile from '../lib/log-tail.ts';

describe('lib/log-tail', () => {
  it('should emit only complete non-empty records from an existing log', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-log-tail-'));
    const path = join(root, 'events.jsonl');

    try {
      await writeFile(path, 'first\n\nsecond\npartial');
      const lines: string[] = [];

      await tailLogFile(path, { follow: false, onLine: (line) => lines.push(line) });

      assert.deepEqual(lines, ['first', 'second']);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
