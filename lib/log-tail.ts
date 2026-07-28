import { watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';

export interface LogTailOptions {
  follow?: boolean;
  onLine: (line: string) => void;
  signal?: AbortSignal;
}

interface LineState {
  offset: number;
  remainder: string;
}

async function readNewLines(
  path: string,
  state: LineState,
  onLine: (line: string) => void,
): Promise<void> {
  const contents = await readFile(path);
  if (contents.byteLength < state.offset) {
    state.offset = 0;
    state.remainder = '';
  }

  const chunk = contents.subarray(state.offset).toString('utf8');
  state.offset = contents.byteLength;
  const lines = `${state.remainder}${chunk}`.split('\n');
  state.remainder = lines.pop() ?? '';
  for (const line of lines) {
    if (line.length > 0) onLine(line);
  }
}

/** Reads complete JSONL records and optionally follows append notifications until aborted. */
export default async function tailLogFile(path: string, options: LogTailOptions): Promise<void> {
  const state: LineState = { offset: 0, remainder: '' };
  await readNewLines(path, state, options.onLine);
  if (options.follow === false || options.signal?.aborted) return;

  await new Promise<void>((resolve, reject) => {
    let pending = Promise.resolve();
    let settled = false;

    const close = (): void => {
      watcher.close();
      options.signal?.removeEventListener('abort', handleAbort);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      close();
      reject(error);
    };
    const handleAbort = (): void => {
      if (settled) return;
      settled = true;
      close();
      void pending.then(resolve, reject);
    };

    const watcher: FSWatcher = watch(path, () => {
      pending = pending.then(() => readNewLines(path, state, options.onLine));
      void pending.catch(fail);
    });
    watcher.once('error', fail);
    options.signal?.addEventListener('abort', handleAbort, { once: true });
  });
}
