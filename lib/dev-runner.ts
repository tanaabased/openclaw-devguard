import type { ChildProcess } from 'node:child_process';

export type StartBuild = () => ChildProcess;
export type StartGateway = () => ChildProcess;
export type StartValidation = () => ChildProcess;

export interface DevRunner {
  requestBuild(): void;
  stop(): Promise<void>;
}

export interface DevRunnerOptions {
  startBuild: StartBuild;
  startGateway: StartGateway;
  startValidation?: StartValidation;
  debounceMs?: number;
  shutdownTimeoutMs?: number;
  onBuildStarted?: () => void;
  onBuildSucceeded?: () => void;
  onGatewayStarted?: (child: ChildProcess) => void;
  onGatewayRestartRequested?: () => void;
  onGatewayStartError?: (error: unknown) => void;
  /** Reports an unexpected active Gateway error or exit, excluding replacement and shutdown. */
  onGatewayExit?: (exit: GatewayExit) => void;
  onBuildError?: (error: unknown) => void;
  onValidationStarted?: () => void;
  onValidationSucceeded?: () => void;
  onValidationError?: (error: unknown) => void;
}

export interface GatewayExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: unknown;
}

type ChildExit = Omit<GatewayExit, 'error'>;

interface GatewayMonitor {
  expectExit(): void;
}

interface ActiveBuild {
  child: ChildProcess;
  cancelled: boolean;
  cancelledPromise: Promise<void>;
  resolveCancelled: () => void;
  stopping?: Promise<void>;
}

async function waitForSuccessfulProcess(
  active: ActiveBuild,
  child: ChildProcess,
  label: string,
): Promise<boolean> {
  const outcome = await Promise.race([
    waitForExit(child).then((exit) => ({ exit })),
    active.cancelledPromise.then(() => ({ cancelled: true as const })),
  ]);
  if ('cancelled' in outcome || active.cancelled) return false;
  if (outcome.exit.code !== 0) {
    const reason = outcome.exit.signal ?? outcome.exit.code ?? 1;
    throw new Error(`${label} failed with exit ${String(reason)}`);
  }
  return true;
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

function monitorGateway(
  child: ChildProcess,
  onUnexpectedExit: (exit: GatewayExit) => void,
): GatewayMonitor {
  let expected = false;
  let settled = false;

  const finish = (exit: GatewayExit): void => {
    if (settled) return;
    settled = true;
    child.removeListener('error', handleError);
    child.removeListener('exit', handleExit);
    if (!expected) onUnexpectedExit(exit);
  };
  const handleError = (error: unknown): void => {
    finish({ code: child.exitCode, signal: child.signalCode, error });
  };
  const handleExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    finish({ code, signal });
  };

  child.once('error', handleError);
  child.once('exit', handleExit);

  return {
    expectExit() {
      expected = true;
    },
  };
}

export default function createDevRunner(options: DevRunnerOptions): DevRunner {
  const debounceMs = options.debounceMs ?? 150;
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000;
  let gateway: ChildProcess | undefined;
  let gatewayMonitor: GatewayMonitor | undefined;
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

  const stopGateway = async (): Promise<void> => {
    const current = gateway;
    if (!current) return;

    gatewayMonitor?.expectExit();
    await stopChild(current, shutdownTimeoutMs);
    if (gateway === current) {
      gateway = undefined;
      gatewayMonitor = undefined;
    }
  };

  const executeBuild = async (): Promise<void> => {
    let child: ChildProcess;
    try {
      options.onBuildStarted?.();
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
      if (!(await waitForSuccessfulProcess(current, child, 'build')) || stopped) return;

      if (options.startValidation) {
        options.onValidationStarted?.();
        if (current.cancelled || stopped) return;
        try {
          const validation = options.startValidation();
          current.child = validation;
          if (!(await waitForSuccessfulProcess(current, validation, 'validation')) || stopped) {
            return;
          }
          options.onValidationSucceeded?.();
        } catch (error) {
          if (!current.cancelled && !stopped) options.onValidationError?.(error);
          return;
        }
      }
      options.onBuildSucceeded?.();
      if (current.cancelled || stopped) return;

      if (gateway) options.onGatewayRestartRequested?.();
      await stopGateway();
      if (!stopped && !current.cancelled) {
        let nextGateway: ChildProcess;
        try {
          nextGateway = options.startGateway();
        } catch (error) {
          options.onGatewayStartError?.(error);
          return;
        }
        gateway = nextGateway;
        gatewayMonitor = monitorGateway(nextGateway, (exit) => {
          if (gateway !== nextGateway) return;
          if (exit.error === undefined) {
            gateway = undefined;
            gatewayMonitor = undefined;
          }
          if (!stopped) options.onGatewayExit?.(exit);
        });
        options.onGatewayStarted?.(nextGateway);
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
      await stopGateway();
    },
  };
}
