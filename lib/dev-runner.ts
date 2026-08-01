import type { ChildProcess } from 'node:child_process';

import {
  type CreateOwnedProcessDeadline,
  type OwnedProcessCleanup,
  OwnedProcessCleanupError,
  OwnedProcessTimeoutError,
  type StopOwnedProcessOptions,
  stopOwnedProcess,
  waitForOwnedProcess,
} from './owned-process.ts';

export const DEVGUARD_MANAGED_RUNTIME_ENV = 'DEVGUARD_MANAGED_RUNTIME';

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
  buildTimeoutMs?: number;
  validationTimeoutMs?: number;
  shutdownGraceMs?: number;
  createDeadline?: CreateOwnedProcessDeadline;
  stopProcess?: (
    child: ChildProcess,
    options: StopOwnedProcessOptions,
  ) => Promise<OwnedProcessCleanup>;
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
  onCleanupIncomplete?: (error: OwnedProcessCleanupError) => void;
}

export interface GatewayExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: unknown;
}

interface GatewayMonitor {
  expectExit(): void;
}

interface ActiveBuild {
  child: ChildProcess;
  cancelled: boolean;
  cancelledPromise: Promise<void>;
  cleanup?: Promise<OwnedProcessCleanup>;
  phase: 'build' | 'validation';
  resolveCancelled: () => void;
  stopping?: Promise<void>;
}

async function waitForSuccessfulProcess(
  active: ActiveBuild,
  child: ChildProcess,
  label: string,
  phase: 'build' | 'validation',
  timeoutMs: number,
  shutdownGraceMs: number,
  createDeadline: CreateOwnedProcessDeadline | undefined,
  stopProcess: NonNullable<DevRunnerOptions['stopProcess']>,
): Promise<boolean> {
  const outcome = await waitForOwnedProcess(child, {
    cancelled: active.cancelledPromise,
    createDeadline,
    phase,
    shutdownGraceMs,
    stopProcess,
    timeoutMs,
  });
  if (outcome.kind === 'cancelled' || active.cancelled) return false;
  if (outcome.code !== 0) {
    const reason = outcome.signal ?? outcome.code ?? 1;
    throw new Error(`${label} failed with exit ${String(reason)}`);
  }
  return true;
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
  const buildTimeoutMs = options.buildTimeoutMs ?? 120_000;
  const validationTimeoutMs = options.validationTimeoutMs ?? 300_000;
  const shutdownGraceMs = options.shutdownGraceMs ?? 5_000;
  const stopProcess = options.stopProcess ?? stopOwnedProcess;
  let gateway: ChildProcess | undefined;
  let gatewayMonitor: GatewayMonitor | undefined;
  let activeBuild: ActiveBuild | undefined;
  let running: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  let stopped = false;
  let cleanupFailed = false;

  const reportIncompleteCleanup = (cleanup: OwnedProcessCleanup): boolean => {
    if (cleanup.outcome !== 'incomplete') return false;
    stopped = true;
    pending = false;
    if (timer) clearTimeout(timer);
    if (!cleanupFailed) {
      cleanupFailed = true;
      options.onCleanupIncomplete?.(new OwnedProcessCleanupError(cleanup));
    }
    return true;
  };

  const reportProcessCleanup = (error: unknown): boolean => {
    if (error instanceof OwnedProcessCleanupError) return reportIncompleteCleanup(error.cleanup);
    return error instanceof OwnedProcessTimeoutError && reportIncompleteCleanup(error.cleanup);
  };

  const stopActiveProcess = (
    current: ActiveBuild,
    child: ChildProcess,
    stopOptions: StopOwnedProcessOptions,
  ): Promise<OwnedProcessCleanup> => {
    if (current.child !== child) return stopProcess(child, stopOptions);
    current.cleanup ??= stopProcess(child, stopOptions);
    return current.cleanup;
  };

  const cancelBuild = async (): Promise<void> => {
    const current = activeBuild;
    if (!current) return;
    if (current.stopping) return current.stopping;

    current.cancelled = true;
    current.stopping = stopActiveProcess(current, current.child, {
      phase: current.phase,
      shutdownGraceMs,
    })
      .then((cleanup) => {
        reportIncompleteCleanup(cleanup);
      })
      .finally(() => {
        current.resolveCancelled();
      });
    return current.stopping;
  };

  const stopGateway = async (): Promise<boolean> => {
    const current = gateway;
    if (!current) return true;

    gatewayMonitor?.expectExit();
    const cleanup = await stopProcess(current, { phase: 'gateway', shutdownGraceMs });
    const complete = !reportIncompleteCleanup(cleanup);
    if (complete && gateway === current) {
      gateway = undefined;
      gatewayMonitor = undefined;
    }
    return complete;
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
      phase: 'build',
      resolveCancelled,
    };
    activeBuild = current;

    try {
      if (
        !(await waitForSuccessfulProcess(
          current,
          child,
          'build',
          'build',
          buildTimeoutMs,
          shutdownGraceMs,
          options.createDeadline,
          (ownedChild, stopOptions) => stopActiveProcess(current, ownedChild, stopOptions),
        )) ||
        stopped
      ) {
        return;
      }

      if (options.startValidation) {
        options.onValidationStarted?.();
        if (current.cancelled || stopped) return;
        try {
          const validation = options.startValidation();
          current.child = validation;
          current.cleanup = undefined;
          current.phase = 'validation';
          if (
            !(await waitForSuccessfulProcess(
              current,
              validation,
              'validation',
              'validation',
              validationTimeoutMs,
              shutdownGraceMs,
              options.createDeadline,
              (ownedChild, stopOptions) => stopActiveProcess(current, ownedChild, stopOptions),
            )) ||
            stopped
          ) {
            return;
          }
          options.onValidationSucceeded?.();
        } catch (error) {
          if (reportProcessCleanup(error)) return;
          if (!current.cancelled && !stopped) options.onValidationError?.(error);
          return;
        }
      }
      options.onBuildSucceeded?.();
      if (current.cancelled || stopped) return;

      if (gateway) options.onGatewayRestartRequested?.();
      if (!(await stopGateway())) return;
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
          void stopProcess(nextGateway, { phase: 'gateway', shutdownGraceMs }).then(
            (cleanup) => {
              if (reportIncompleteCleanup(cleanup)) return;
              if (gateway === nextGateway) {
                gateway = undefined;
                gatewayMonitor = undefined;
              }
              if (!stopped) options.onGatewayExit?.(exit);
            },
            (error: unknown) => {
              reportIncompleteCleanup({
                detail: error instanceof Error ? error.message : String(error),
                outcome: 'incomplete',
                phase: 'gateway',
                pid: nextGateway.pid,
                signals: [],
              });
            },
          );
        });
        options.onGatewayStarted?.(nextGateway);
      }
    } catch (error) {
      if (reportProcessCleanup(error)) return;
      if (!current.cancelled && !stopped) options.onBuildError?.(error);
    } finally {
      if (activeBuild === current) activeBuild = undefined;
    }
  };

  const rebuild = (): void => {
    if (stopped) return;
    if (running) {
      pending = true;
      void cancelBuild().catch((error: unknown) => {
        if (!stopped) options.onBuildError?.(error);
      });
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
