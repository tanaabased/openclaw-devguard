import { spawn } from 'node:child_process';

import chokidar from 'chokidar';

import createDevRunner, { DEVGUARD_MANAGED_RUNTIME_ENV } from '../lib/dev-runner.ts';

const runner = createDevRunner({
  startBuild: () => spawn('bun', ['run', 'build'], { stdio: 'inherit' }),
  startGateway: () =>
    spawn('openclaw', ['--dev', 'gateway', 'run'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        [DEVGUARD_MANAGED_RUNTIME_ENV]: '1',
        OPENCLAW_SKIP_CHANNELS: '1',
        OPENCLAW_PLUGIN_LIFECYCLE_TRACE: '1',
      },
    }),
  onBuildError: (error) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
  },
});

const watcher = chokidar.watch(
  [
    'index.ts',
    'cli/**/*.ts',
    'lib/**/*.ts',
    'utils/**/*.ts',
    'openclaw.plugin.json',
    'package.json',
    'tsconfig*.json',
  ],
  { ignoreInitial: true },
);
watcher.on('all', () => runner.requestBuild());

const shutdown = async (): Promise<void> => {
  await watcher.close();
  await runner.stop();
  process.exit(0);
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
runner.requestBuild();
