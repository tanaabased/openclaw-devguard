import { spawn } from 'node:child_process';

async function run(command: string, args: string[]): Promise<void> {
  const child = spawn(command, args, { stdio: 'inherit' });
  const code = await new Promise<number | null>((resolve) => child.once('exit', resolve));
  if (code !== 0) process.exit(code ?? 1);
}

await run('bun', ['run', 'build']);
await run('openclaw', ['--dev', 'plugins', 'install', '--link', '.']);
await run('openclaw', ['--dev', 'plugins', 'enable', 'openclaw-devguard']);
