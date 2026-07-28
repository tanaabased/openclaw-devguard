import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface RuntimeEvent {
  event: string;
  [key: string]: unknown;
}

export interface RuntimeEventRecorder {
  flush(): Promise<void>;
  record(event: RuntimeEvent): void;
}

export interface RuntimeEventRecorderOptions {
  base?: Readonly<Record<string, unknown>>;
  logPath: string;
  now?: () => Date;
  append?: (path: string, record: RuntimeEvent) => Promise<void>;
  onError?: (error: unknown) => void;
}

async function appendJsonl(path: string, record: RuntimeEvent): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, 'utf8');
}

/** Serializes lifecycle records so their JSONL order matches the observed run order. */
export default function createRuntimeEventRecorder(
  options: RuntimeEventRecorderOptions,
): RuntimeEventRecorder {
  const append = options.append ?? appendJsonl;
  const now = options.now ?? (() => new Date());
  let pending = Promise.resolve();

  return {
    record(event) {
      const record = {
        timestamp: now().toISOString(),
        ...options.base,
        ...event,
      };
      pending = pending
        .then(() => append(options.logPath, record))
        .catch((error: unknown) => options.onError?.(error));
    },
    flush() {
      return pending;
    },
  };
}
