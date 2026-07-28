import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { watch, type FSWatcher } from 'chokidar';

import shouldReportFileChange, {
  type FileChangeEventName,
  type FileSignature,
} from '../utils/file-change.ts';

export type ProjectWatchEventName = FileChangeEventName;

export interface ProjectWatchEvent {
  event: ProjectWatchEventName;
  path: string;
}

export interface ProjectWatcher {
  close(): Promise<void>;
}

export interface ProjectWatcherOptions {
  root: string;
  paths: string[];
  onChange: (event: ProjectWatchEvent) => void;
  onError: (error: unknown) => void;
  stabilityThresholdMs?: number;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function statKey(stats: Stats): string {
  return [stats.dev, stats.ino, stats.size, stats.mtimeMs, stats.ctimeMs].join(':');
}

async function readSignature(path: string, knownStats?: Stats): Promise<FileSignature | undefined> {
  let stats = knownStats;
  try {
    stats ??= await stat(path);
    if (!stats.isFile()) return undefined;

    return {
      contentHash: createHash('sha256')
        .update(await readFile(path))
        .digest('base64url'),
      statKey: statKey(stats),
    };
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

export default async function createProjectWatcher(
  options: ProjectWatcherOptions,
): Promise<ProjectWatcher> {
  const absolutePaths = options.paths.map((path) => resolve(options.root, path));
  await Promise.all(absolutePaths.map((path) => stat(path)));
  if (absolutePaths.length === 0) return { close: () => Promise.resolve() };

  const signatures = new Map<string, FileSignature>();
  const watcher: FSWatcher = watch(absolutePaths, {
    alwaysStat: true,
    atomic: true,
    awaitWriteFinish: {
      stabilityThreshold: options.stabilityThresholdMs ?? 100,
      pollInterval: 25,
    },
    ignoreInitial: false,
  });
  let initialized = false;
  let initializationError: unknown;
  let pending = Promise.resolve();

  const handle = async (
    event: ProjectWatchEventName,
    path: string,
    stats?: Stats,
  ): Promise<void> => {
    if (event === 'unlink') {
      const previous = signatures.get(path);
      signatures.delete(path);
      if (shouldReportFileChange({ event, initialized, previous })) {
        options.onChange({ event, path });
      }
      return;
    }

    const previous = signatures.get(path);
    const nextStatKey = stats ? statKey(stats) : undefined;
    if (previous && previous.statKey === nextStatKey) return;

    const next = await readSignature(path, stats);
    if (!next) return;
    signatures.set(path, next);
    if (shouldReportFileChange({ event, initialized, next, previous })) {
      options.onChange({ event, path });
    }
  };

  const enqueue = (event: ProjectWatchEventName, path: string, stats?: Stats): void => {
    pending = pending
      .then(() => handle(event, path, stats))
      .catch((error: unknown) => {
        if (initialized) options.onError(error);
        else initializationError ??= error;
      });
  };

  watcher.on('add', (path, stats) => enqueue('add', path, stats));
  watcher.on('change', (path, stats) => enqueue('change', path, stats));
  watcher.on('unlink', (path) => enqueue('unlink', path));

  const ready = new Promise<void>((resolveReady, rejectReady) => {
    watcher.on('error', (error) => {
      if (initialized) options.onError(error);
      else rejectReady(error);
    });
    watcher.once('ready', () => {
      pending = pending.then(() => {
        if (initializationError) throw initializationError;
        initialized = true;
      });
      void pending.then(resolveReady, rejectReady);
    });
  });

  try {
    await ready;
  } catch (error) {
    await watcher.close();
    throw error;
  }

  return {
    async close() {
      await watcher.close();
      await pending;
    },
  };
}
