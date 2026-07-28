import { spawn } from 'node:child_process';

export interface ProcessCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  inherit?: boolean;
  allowFailure?: boolean;
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
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: [
      options.input === undefined ? 'ignore' : 'pipe',
      options.inherit ? 'inherit' : 'pipe',
      options.inherit ? 'inherit' : 'pipe',
    ],
  });
  let output = '';
  if (child.stdout) child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  if (child.stderr) child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  if (options.input !== undefined) child.stdin?.end(options.input);

  const code =
    (await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    })) ?? 1;
  if (code !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} failed (${code})${output ? `\n${output}` : ''}`);
  }
  return { code, output };
}
