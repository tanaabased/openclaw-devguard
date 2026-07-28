import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface RunOptions {
  allowFailure?: boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

interface RunResult {
  code: number;
  output: string;
}

async function run(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  const child = spawn(command, args, {
    cwd: options.cwd,
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
const fixtureDirectory = join(temporaryRoot, 'fixture-plugin');
const isolatedEnvironment = {
  ...process.env,
  OPENCLAW_STATE_DIR: stateDirectory,
  OPENCLAW_SKIP_CHANNELS: '1',
  DEVGUARD_HOME: join(temporaryRoot, 'devguard-home'),
  npm_config_cache: join(temporaryRoot, 'npm-cache'),
};

try {
  await run('bun', ['run', 'build']);
  await run('bun', ['run', 'plugin:check']);

  const packed = await run('npm', ['pack', '--json', '--pack-destination', temporaryRoot], {
    env: isolatedEnvironment,
  });
  const packResult = JSON.parse(packed.output) as Array<{
    filename: string;
    files?: Array<{ path: string }>;
  }>;
  const packedPaths = new Set(packResult[0]?.files?.map(({ path }) => path));
  for (const path of [
    'cli/init.ts',
    'cli/run.ts',
    'lib/cli-output.ts',
    'lib/logger.ts',
    'lib/register-cli.ts',
  ]) {
    assert.equal(packedPaths.has(path), true, `packed plugin is missing ${path}`);
  }
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
  assert.match(runHelp.output, /--once/);

  await mkdir(fixtureDirectory, { recursive: true });
  await writeFile(
    join(fixtureDirectory, 'package.json'),
    JSON.stringify(
      {
        name: 'devguard-fixture-plugin',
        version: '0.0.0',
        type: 'module',
        packageManager: 'bun@1.3.14',
        scripts: {
          build: 'bun build index.ts --outdir dist --target node --format esm --external openclaw',
        },
        openclaw: {
          extensions: ['./index.ts'],
          runtimeExtensions: ['./dist/index.js'],
        },
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(
    join(fixtureDirectory, 'openclaw.plugin.json'),
    JSON.stringify(
      {
        id: 'devguard-fixture',
        name: 'DevGuard fixture',
        version: '0.0.0',
        activation: { onStartup: true },
        configSchema: { type: 'object', additionalProperties: false, properties: {} },
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(
    join(fixtureDirectory, 'index.ts'),
    [
      "import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';",
      '',
      'export default definePluginEntry({',
      "  id: 'devguard-fixture',",
      "  name: 'DevGuard fixture',",
      '  register() {},',
      '});',
      '',
    ].join('\n'),
  );

  const initialized = await run('openclaw', ['devguard', 'init', fixtureDirectory], {
    env: isolatedEnvironment,
  });
  assert.match(initialized.output, /DevGuard initialized for devguard-fixture/);
  assert.match(initialized.output, /Isolated state:/);
  const projectConfig = JSON.parse(
    await readFile(join(fixtureDirectory, 'devguard.json'), 'utf8'),
  ) as { plugin?: { id?: string } };
  assert.equal(projectConfig.plugin?.id, 'devguard-fixture');
  const projectsRoot = join(temporaryRoot, 'devguard-home', 'projects');
  const projectDirectories = await readdir(projectsRoot);
  assert.equal(projectDirectories.length, 1);
  const projectStateRoot = join(projectsRoot, projectDirectories[0] ?? '');
  const initialGatewayToken = await readFile(join(projectStateRoot, 'gateway-token'), 'utf8');

  const reinitialized = await run('openclaw', ['devguard', 'init', fixtureDirectory], {
    env: isolatedEnvironment,
  });
  assert.match(reinitialized.output, /Configuration: reused/);
  assert.equal(
    await readFile(join(projectStateRoot, 'gateway-token'), 'utf8'),
    initialGatewayToken,
  );

  const runtime = await run('openclaw', ['devguard', 'run', '--once'], {
    cwd: fixtureDirectory,
    env: isolatedEnvironment,
  });
  assert.match(runtime.output, /DevGuard\b.*\bready\b.*\bbuild\b/);
  assert.match(runtime.output, /hook active/);

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
