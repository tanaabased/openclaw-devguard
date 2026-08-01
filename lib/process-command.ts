import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

import {
  type CreateOwnedProcessDeadline,
  type OwnedProcessCleanup,
  type OwnedProcessPhase,
  type StopOwnedProcessOptions,
  stopOwnedProcess,
  waitForOwnedProcess,
} from './owned-process.ts';

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface ProcessCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  inherit?: boolean;
  inheritStdin?: boolean;
  allowFailure?: boolean;
  timeoutMs?: number;
  shutdownGraceMs?: number;
  phase?: OwnedProcessPhase;
  createDeadline?: CreateOwnedProcessDeadline;
  spawnProcess?: SpawnProcess;
  stopProcess?: (
    child: ChildProcess,
    options: StopOwnedProcessOptions,
  ) => Promise<OwnedProcessCleanup>;
}

export interface ProcessCommandResult {
  code: number;
  output: string;
}

export default async function processCommand(
  command: string,
  args: readonly string[],
  options: ProcessCommandOptions = {},
): Promise<ProcessCommandResult> {
  const child = (options.spawnProcess ?? spawn)(command, args, {
    cwd: options.cwd,
    detached: options.timeoutMs !== undefined,
    env: options.env ?? process.env,
    stdio: [
      options.inheritStdin ? 'inherit' : options.input === undefined ? 'ignore' : 'pipe',
      options.inherit ? 'inherit' : 'pipe',
      options.inherit ? 'inherit' : 'pipe',
    ],
  });
  let output = '';
  if (child.stdout) child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  if (child.stderr) child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  if (options.input !== undefined) child.stdin?.end(options.input);

  const outcome =
    options.timeoutMs === undefined
      ? await new Promise<{
          code: number | null;
          kind: 'exit';
          signal: NodeJS.Signals | null;
        }>((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', (code, signal) => resolve({ code, kind: 'exit', signal }));
        })
      : await waitForOwnedProcess(child, {
          createDeadline: options.createDeadline,
          phase: options.phase ?? 'command',
          shutdownGraceMs: options.shutdownGraceMs ?? 5_000,
          stopProcess: options.stopProcess ?? stopOwnedProcess,
          timeoutMs: options.timeoutMs,
        });
  if (outcome.kind === 'cancelled') throw new Error(`${command} was cancelled unexpectedly`);
  const code = outcome.code ?? 1;
  if (code !== 0 && !options.allowFailure) {
    const reason = outcome.signal ?? code;
    throw new Error(
      `${command} ${args.join(' ')} failed (${reason})${output ? `\n${output}` : ''}`,
    );
  }
  return { code, output };
}
