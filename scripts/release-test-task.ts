import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface RunOptions {
  env?: NodeJS.ProcessEnv;
}

interface RunResult {
  code: number;
  output: string;
}

interface PackResult {
  filename?: string;
  files?: Array<{ path: string }>;
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

  if (code !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${code})\n${output}`);
  }

  return { code, output };
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'openclaw-devguard-package-'));
const environment = {
  ...process.env,
  npm_config_cache: join(temporaryRoot, 'npm-cache'),
};

try {
  await run('bun', ['run', 'build']);
  await run('bun', ['run', 'plugin:check']);

  const packed = await run('npm', ['pack', '--json', '--pack-destination', temporaryRoot], {
    env: environment,
  });
  const packageResult = (JSON.parse(packed.output) as PackResult[])[0];
  if (!packageResult?.filename) throw new Error('npm pack did not report an archive');

  const packedPaths = new Set(packageResult.files?.map(({ path }) => path));
  const requiredPaths = [
    'package.json',
    'openclaw.plugin.json',
    'dist/index.js',
    'dist/index.js.map',
    'dist/exec-probe-task.js',
    'dist/exec-probe-task.js.map',
    'index.ts',
    'cli/doctor.ts',
    'cli/exec.ts',
    'cli/init.ts',
    'cli/profile.ts',
    'cli/restore.ts',
    'cli/run.ts',
    'cli/shell.ts',
    'cli/tail.ts',
    'lib/cli-output.ts',
    'lib/logger.ts',
    'lib/register-cli.ts',
    'utils/supported-host.ts',
    'assets/devbot.png',
    'assets/devguard-small.png',
    'README.md',
    'ADVANCED.md',
    'DEVELOPMENT.md',
    'CHANGELOG.md',
    'LICENSE',
  ];
  for (const path of requiredPaths) {
    assert.equal(packedPaths.has(path), true, `packed plugin is missing ${path}`);
  }
  for (const path of ['assets/devguard.png', 'assets/openclaw.png', 'SPEC.md']) {
    assert.equal(packedPaths.has(path), false, `packed plugin must exclude ${path}`);
  }

  assert.match(packageResult.filename, /\.tgz$/);
  await access(join(temporaryRoot, packageResult.filename));
  process.stdout.write('release package test: ok\n');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
