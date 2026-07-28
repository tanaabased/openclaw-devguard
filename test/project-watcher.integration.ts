import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import createProjectWatcher, { type ProjectWatchEvent } from '../lib/project-watcher.ts';

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe('lib/project-watcher integration', () => {
  it('should ignore reads and metadata-only changes before reporting a content change', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-project-watcher-'));
    const file = join(root, 'index.ts');
    await writeFile(file, 'alpha\n');
    const events: ProjectWatchEvent[] = [];
    let resolveContentChange!: () => void;
    const contentChanged = new Promise<void>((resolve) => {
      resolveContentChange = resolve;
    });
    let watcher;

    try {
      watcher = await createProjectWatcher({
        root,
        paths: ['index.ts'],
        onChange: (event) => {
          events.push(event);
          resolveContentChange();
        },
        onError: (error) => assert.fail(error instanceof Error ? error : String(error)),
        stabilityThresholdMs: 20,
      });

      await readFile(file);
      const fileStats = await stat(file);
      await utimes(file, fileStats.atime, new Date(fileStats.mtimeMs + 1_000));
      await delay(100);
      assert.deepEqual(events, []);

      await writeFile(file, 'bravo\n');
      await Promise.race([
        contentChanged,
        delay(1_000).then(() => assert.fail('timed out waiting for a content change')),
      ]);

      assert.deepEqual(events, [{ event: 'change', path: file }]);
    } finally {
      await watcher?.close();
      await rm(root, { recursive: true });
    }
  });
});
