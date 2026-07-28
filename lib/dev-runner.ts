import type { ChildProcess } from 'node:child_process';

export type Build = () => Promise<void>;
export type StartGateway = () => ChildProcess;

export interface DevRunner {
  requestBuild(): void;
  stop(): Promise<void>;
}

export interface DevRunnerOptions {
  build: Build;
  startGateway: StartGateway;
  debounceMs?: number;
  onBuildError?: (error: unknown) => void;
}

function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });
}

export default function createDevRunner(options: DevRunnerOptions): DevRunner {
  const debounceMs = options.debounceMs ?? 150;
  let gateway: ChildProcess | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let pending = false;
  let stopped = false;

  const rebuild = async (): Promise<void> => {
    if (running || stopped) {
      pending = !stopped;
      return;
    }

    running = true;
    try {
      await options.build();
      await stopChild(gateway);
      if (!stopped) {
        gateway = options.startGateway();
      }
    } catch (error) {
      options.onBuildError?.(error);
    } finally {
      running = false;
      if (pending && !stopped) {
        pending = false;
        await rebuild();
      }
    }
  };

  return {
    requestBuild() {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void rebuild();
      }, debounceMs);
    },
    async stop() {
      stopped = true;
      pending = false;
      if (timer) clearTimeout(timer);
      await stopChild(gateway);
    },
  };
}
