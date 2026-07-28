import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface RunOptions {
  allowFailure?: boolean;
  env?: NodeJS.ProcessEnv;
}

interface RunResult {
  code: number;
  output: string;
}

async function run(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  const child = spawn(command, args, {
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const code = (await new Promise<number | null>((resolve) => child.once('exit', resolve))) ?? 1;

  if (code !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} failed (${code})\n${output}`);
  }

  return { code, output };
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'openclaw-devguard-release-'));
const stateDirectory = join(temporaryRoot, 'state');
const isolatedEnvironment = {
  ...process.env,
  OPENCLAW_STATE_DIR: stateDirectory,
  OPENCLAW_SKIP_CHANNELS: '1',
  npm_config_cache: join(temporaryRoot, 'npm-cache'),
};

try {
  await run('bun', ['run', 'build']);
  await run('bun', ['run', 'plugin:check']);

  const packed = await run('npm', ['pack', '--json', '--pack-destination', temporaryRoot], {
    env: isolatedEnvironment,
  });
  const packResult = JSON.parse(packed.output) as Array<{ filename: string }>;
  const archive = join(temporaryRoot, packResult[0]?.filename ?? '');
  assert.notEqual(archive, temporaryRoot, 'npm pack did not report an archive');

  await run('openclaw', ['plugins', 'install', archive, '--force'], { env: isolatedEnvironment });
  await run('openclaw', ['plugins', 'enable', 'openclaw-devguard'], {
    env: isolatedEnvironment,
  });
  const inspection = await run(
    'openclaw',
    ['plugins', 'inspect', 'openclaw-devguard', '--runtime', '--json'],
    { env: isolatedEnvironment },
  );
  assert.match(inspection.output, /openclaw-devguard/);
  assert.match(inspection.output, /dist\/index\.js/);
  await run('openclaw', ['plugins', 'doctor'], { env: isolatedEnvironment });

  const help = await run('openclaw', ['devguard', '--help'], { env: isolatedEnvironment });
  assert.match(help.output, /init/);
  assert.match(help.output, /doctor/);
  const initHelp = await run('openclaw', ['devguard', 'init', '--help'], {
    env: isolatedEnvironment,
  });
  assert.match(initHelp.output, /\[plugin-path\]/);
  const runHelp = await run('openclaw', ['devguard', 'run', '--help'], {
    env: isolatedEnvironment,
  });
  assert.match(runHelp.output, /--unsafe-raw-stream/);

  const unfinished = await run('openclaw', ['devguard', 'doctor'], {
    allowFailure: true,
    env: isolatedEnvironment,
  });
  assert.notEqual(unfinished.code, 0);
  assert.match(unfinished.output, /not implemented in this structural scaffold/);

  process.stdout.write('release test: ok\n');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
