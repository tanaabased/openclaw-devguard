import { type ChildProcess } from 'node:child_process';

export type OwnedProcessPhase = 'build' | 'command' | 'gateway' | 'validation';
export type OwnedProcessSignal = 'SIGKILL' | 'SIGTERM';

export interface OwnedProcessCleanup {
  detail?: string;
  outcome: 'already-exited' | 'incomplete' | 'killed' | 'terminated';
  phase: OwnedProcessPhase;
  pid?: number;
  signals: OwnedProcessSignal[];
}

export interface OwnedProcessDeadline {
  cancel(): void;
  elapsed: Promise<void>;
}

export type CreateOwnedProcessDeadline = (timeoutMs: number) => OwnedProcessDeadline;

export interface StopOwnedProcessOptions {
  groupAlive?: (pid: number) => boolean;
  phase: OwnedProcessPhase;
  shutdownGraceMs: number;
  signalGroup?: (pid: number, signal: OwnedProcessSignal) => void;
  waitForGroupExit?: (pid: number, timeoutMs: number) => Promise<boolean>;
}

export interface WaitForOwnedProcessOptions {
  cancelled?: Promise<void>;
  createDeadline?: CreateOwnedProcessDeadline;
  phase: OwnedProcessPhase;
  shutdownGraceMs: number;
  stopProcess?: (
    child: ChildProcess,
    options: StopOwnedProcessOptions,
  ) => Promise<OwnedProcessCleanup>;
  timeoutMs: number;
}

export type OwnedProcessWaitResult =
  { kind: 'cancelled' } | { code: number | null; kind: 'exit'; signal: NodeJS.Signals | null };

export class OwnedProcessTimeoutError extends Error {
  readonly code = 'DEVGUARD_PROCESS_TIMEOUT';

  constructor(
    readonly phase: OwnedProcessPhase,
    readonly timeoutMs: number,
    readonly cleanup: OwnedProcessCleanup,
  ) {
    const seconds = timeoutMs / 1_000;
    const duration = `${String(seconds)} ${seconds === 1 ? 'second' : 'seconds'}`;
    const detail =
      cleanup.outcome === 'incomplete'
        ? `; cleanup is incomplete${cleanup.pid === undefined ? '' : ` for pid ${cleanup.pid}`}; terminate it manually before retrying`
        : `; cleanup ${cleanup.outcome}`;
    super(`DevGuard ${phase} timed out after ${duration}${detail}`);
    this.name = 'OwnedProcessTimeoutError';
  }
}

export class OwnedProcessCleanupError extends Error {
  readonly code = 'DEVGUARD_PROCESS_CLEANUP_INCOMPLETE';

  constructor(readonly cleanup: OwnedProcessCleanup) {
    const process =
      cleanup.pid === undefined ? 'owned process' : `owned process pid ${cleanup.pid}`;
    super(
      `DevGuard could not verify cleanup of ${process} during ${cleanup.phase}; terminate it manually before retrying`,
    );
    this.name = 'OwnedProcessCleanupError';
  }
}

export function createOwnedProcessDeadline(timeoutMs: number): OwnedProcessDeadline {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const elapsed = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  return {
    cancel() {
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
    elapsed,
  };
}

function processGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function signalProcessGroup(pid: number, signal: OwnedProcessSignal): void {
  process.kill(-pid, signal);
}

async function waitForProcessGroupExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (processGroupAlive(pid)) {
    if (Date.now() >= deadline) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(50, timeoutMs)));
  }
  return true;
}

function signalFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function processIsMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ESRCH'
  );
}

/** Gracefully stops one detached process group, escalates, and verifies that the group is gone. */
export async function stopOwnedProcess(
  child: ChildProcess,
  options: StopOwnedProcessOptions,
): Promise<OwnedProcessCleanup> {
  const pid = child.pid;
  const signals: OwnedProcessSignal[] = [];
  if (pid === undefined) {
    return { outcome: 'already-exited', phase: options.phase, signals };
  }

  const groupAlive = options.groupAlive ?? processGroupAlive;
  const signalGroup = options.signalGroup ?? signalProcessGroup;
  const waitForGroupExit = options.waitForGroupExit ?? waitForProcessGroupExit;
  if (!groupAlive(pid)) {
    return { outcome: 'already-exited', phase: options.phase, pid, signals };
  }

  try {
    signalGroup(pid, 'SIGTERM');
    signals.push('SIGTERM');
  } catch (error) {
    if (processIsMissing(error)) {
      return { outcome: 'already-exited', phase: options.phase, pid, signals };
    }
    return {
      detail: `could not send SIGTERM: ${signalFailure(error)}`,
      outcome: 'incomplete',
      phase: options.phase,
      pid,
      signals,
    };
  }
  if (await waitForGroupExit(pid, options.shutdownGraceMs)) {
    return { outcome: 'terminated', phase: options.phase, pid, signals };
  }

  try {
    signalGroup(pid, 'SIGKILL');
    signals.push('SIGKILL');
  } catch (error) {
    if (processIsMissing(error)) {
      return { outcome: 'terminated', phase: options.phase, pid, signals };
    }
    return {
      detail: `could not send SIGKILL: ${signalFailure(error)}`,
      outcome: 'incomplete',
      phase: options.phase,
      pid,
      signals,
    };
  }
  if (await waitForGroupExit(pid, options.shutdownGraceMs)) {
    return { outcome: 'killed', phase: options.phase, pid, signals };
  }

  return {
    detail: 'process group remained active after SIGKILL',
    outcome: 'incomplete',
    phase: options.phase,
    pid,
    signals,
  };
}

function waitForExit(child: ChildProcess): Promise<OwnedProcessWaitResult> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, kind: 'exit', signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, kind: 'exit', signal }));
  });
}

/** Waits for one owned child, returning cancellation separately and verifying descendant cleanup. */
export async function waitForOwnedProcess(
  child: ChildProcess,
  options: WaitForOwnedProcessOptions,
): Promise<OwnedProcessWaitResult> {
  const deadline = (options.createDeadline ?? createOwnedProcessDeadline)(options.timeoutMs);
  const stopProcess = options.stopProcess ?? stopOwnedProcess;
  try {
    let outcome;
    try {
      outcome = await Promise.race([
        waitForExit(child),
        deadline.elapsed.then(() => ({ kind: 'timeout' as const })),
        ...(options.cancelled
          ? [options.cancelled.then(() => ({ kind: 'cancelled' as const }))]
          : []),
      ]);
    } catch (error) {
      const cleanup = await stopProcess(child, {
        phase: options.phase,
        shutdownGraceMs: options.shutdownGraceMs,
      });
      if (cleanup.outcome === 'incomplete') throw new OwnedProcessCleanupError(cleanup);
      throw error;
    }
    if (outcome.kind === 'cancelled') return outcome;
    if (outcome.kind === 'exit') {
      const cleanup = await stopProcess(child, {
        phase: options.phase,
        shutdownGraceMs: options.shutdownGraceMs,
      });
      if (cleanup.outcome === 'incomplete') throw new OwnedProcessCleanupError(cleanup);
      return outcome;
    }

    const cleanup = await stopProcess(child, {
      phase: options.phase,
      shutdownGraceMs: options.shutdownGraceMs,
    });
    throw new OwnedProcessTimeoutError(options.phase, options.timeoutMs, cleanup);
  } finally {
    deadline.cancel();
  }
}
