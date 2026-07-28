import type { ChildProcess } from 'node:child_process';

export type StartBuild = () => ChildProcess;
export type StartGateway = () => ChildProcess;

export interface DevRunner {
  requestBuild(): void;
  stop(): Promise<void>;
}

export interface DevRunnerOptions {
  startBuild: StartBuild;
  startGateway: StartGateway;
  debounceMs?: number;
  shutdownTimeoutMs?: number;
  onBuildError?: (error: unknown) => void;
}

interface ChildExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface ActiveBuild {
  child: ChildProcess;
  cancelled: boolean;
  cancelledPromise: Promise<void>;
  resolveCancelled: () => void;
  stopping?: Promise<void>;
}

function waitForExit(child: ChildProcess): Promise<ChildExit> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }

  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

function stopChild(child: ChildProcess | undefined, timeoutMs: number): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('error', finish);
      child.removeListener('exit', finish);
      resolve();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish();
    }, timeoutMs);

    child.once('error', finish);
    child.once('exit', finish);
    if (!child.kill('SIGTERM')) finish();
  });
}

export default function createDevRunner(options: DevRunnerOptions): DevRunner {
  const debounceMs = options.debounceMs ?? 150;
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000;
  let gateway: ChildProcess | undefined;
  let activeBuild: ActiveBuild | undefined;
  let running: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  let stopped = false;

  const cancelBuild = async (): Promise<void> => {
    const current = activeBuild;
    if (!current) return;
    if (current.stopping) return current.stopping;

    current.cancelled = true;
    current.stopping = stopChild(current.child, shutdownTimeoutMs).finally(() => {
      current.resolveCancelled();
    });
    return current.stopping;
  };

  const executeBuild = async (): Promise<void> => {
    let child: ChildProcess;
    try {
      child = options.startBuild();
    } catch (error) {
      if (!stopped) options.onBuildError?.(error);
      return;
    }

    let resolveCancelled = (): void => undefined;
    const cancelledPromise = new Promise<void>((resolve) => {
      resolveCancelled = resolve;
    });
    const current: ActiveBuild = {
      child,
      cancelled: false,
      cancelledPromise,
      resolveCancelled,
    };
    activeBuild = current;

    try {
      const outcome = await Promise.race([
        waitForExit(child).then((exit) => ({ exit })),
        current.cancelledPromise.then(() => ({ cancelled: true as const })),
      ]);
      if ('cancelled' in outcome || current.cancelled || stopped) return;
      if (outcome.exit.code !== 0) {
        const reason = outcome.exit.signal ?? outcome.exit.code ?? 1;
        throw new Error(`build failed with exit ${String(reason)}`);
      }

      const previousGateway = gateway;
      await stopChild(previousGateway, shutdownTimeoutMs);
      if (gateway === previousGateway) gateway = undefined;
      if (!stopped && !current.cancelled) {
        gateway = options.startGateway();
      }
    } catch (error) {
      if (!current.cancelled && !stopped) options.onBuildError?.(error);
    } finally {
      if (activeBuild === current) activeBuild = undefined;
    }
  };

  const rebuild = (): void => {
    if (stopped) return;
    if (running) {
      pending = true;
      void cancelBuild();
      return;
    }

    const operation = executeBuild();
    running = operation;
    void operation.finally(() => {
      if (running === operation) running = undefined;
      if (pending && !stopped) {
        pending = false;
        rebuild();
      }
    });
  };

  return {
    requestBuild() {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        rebuild();
      }, debounceMs);
    },
    async stop() {
      stopped = true;
      pending = false;
      if (timer) clearTimeout(timer);
      await cancelBuild();
      await running;
      await stopChild(gateway, shutdownTimeoutMs);
      gateway = undefined;
    },
  };
}
