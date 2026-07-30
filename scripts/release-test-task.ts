import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
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

interface ClawHubValidation {
  status?: string;
  summary?: {
    breakageCount?: number;
    warningCount?: number;
  };
}

let attemptedChecks = 0;
let passedChecks = 0;

async function check<T>(label: string, action: () => T | Promise<T>): Promise<T> {
  const checkNumber = ++attemptedChecks;
  try {
    const result = await action();
    passedChecks += 1;
    process.stdout.write(`ok ${checkNumber} - ${label}\n`);
    return result;
  } catch (error) {
    process.stderr.write(`not ok ${checkNumber} - ${label}\n`);
    throw error;
  }
}

async function run(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  const child = spawn(command, args, {
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const code = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (exitCode) => resolve(exitCode ?? 1));
  });

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
  await check('build the plugin runtime', () => run('bun', ['run', 'build']));
  await check('validate plugin metadata', () => run('bun', ['run', 'plugin:check']));

  const { archivePath, packageResult } = await check('create the npm package archive', async () => {
    const packed = await run(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', temporaryRoot],
      { env: environment },
    );
    const result = (JSON.parse(packed.output) as PackResult[])[0];
    if (!result?.filename) throw new Error('npm pack did not report an archive');
    assert.match(result.filename, /\.tgz$/);
    const path = join(temporaryRoot, result.filename);
    await access(path);
    return { archivePath: path, packageResult: result };
  });

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
  await check('include required package files', () => {
    for (const path of requiredPaths) {
      assert.equal(packedPaths.has(path), true, `packed plugin is missing ${path}`);
    }
  });
  await check('exclude non-package files', () => {
    for (const path of ['assets/devguard.png', 'assets/openclaw.png', 'SPEC.md']) {
      assert.equal(packedPaths.has(path), false, `packed plugin must exclude ${path}`);
    }
  });

  const packageRoot = await check('extract the npm package archive', async () => {
    const unpackedRoot = join(temporaryRoot, 'unpacked');
    await mkdir(unpackedRoot);
    await run('tar', ['-xzf', archivePath, '-C', unpackedRoot]);
    return join(unpackedRoot, 'package');
  });

  await check('pass ClawHub package validation without warnings', async () => {
    const clawHubReports = join(temporaryRoot, 'clawhub-reports');
    const clawHubResult = await run('clawhub', [
      'package',
      'validate',
      packageRoot,
      '--out',
      clawHubReports,
    ]);
    const clawHubValidation = JSON.parse(
      await readFile(join(clawHubReports, 'plugin-inspector-report.json'), 'utf8'),
    ) as ClawHubValidation;
    const clawHubOutput = clawHubResult.output.trim();
    assert.equal(
      clawHubValidation.status,
      'pass',
      `ClawHub package validation must pass\n${clawHubOutput}`,
    );
    assert.equal(
      clawHubValidation.summary?.breakageCount,
      0,
      `ClawHub package validation must report no breakages\n${clawHubOutput}`,
    );
    assert.equal(
      clawHubValidation.summary?.warningCount,
      0,
      `ClawHub package validation must report no warnings\n${clawHubOutput}`,
    );
  });
} catch (error) {
  process.stderr.write(
    `release package checks: failed (${passedChecks}/${attemptedChecks} passed)\n`,
  );
  throw error;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write(`release package checks: ok (${passedChecks} passed)\n`);
