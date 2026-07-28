import { spawn, type ChildProcess } from 'node:child_process';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { callGatewayFromCli } from 'openclaw/plugin-sdk/gateway-runtime';

import createDevRunner from '../lib/dev-runner.ts';
import { defaultCliOutput, type CliOutput } from '../lib/cli-output.ts';
import waitForGatewayStatus, { type GatewayStatus } from '../lib/gateway-status.ts';
import { logDebug, logInfo, type Logger, reportError } from '../lib/logger.ts';
import createProjectWatcher from '../lib/project-watcher.ts';
import {
  DEVGUARD_PROJECT_FILE,
  readProjectConfig,
  resolveProjectPaths,
} from '../lib/project-config.ts';

export interface RunDevguardOptions {
  environment?: NodeJS.ProcessEnv;
  logger: Logger;
  once?: boolean;
  output?: CliOutput;
  unsafeRawStream?: boolean;
  startupTimeoutMs?: number;
}

async function appendRuntimeEvent(logPath: string, event: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(
    logPath,
    `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`,
    'utf8',
  );
}

function recordRuntimeEvent(logPath: string, event: Record<string, unknown>, logger: Logger): void {
  void appendRuntimeEvent(logPath, event).catch((error: unknown) => {
    reportError(logger, 'could not append a lifecycle event', error);
  });
}

export default async function runDevguard(
  projectRoot: string,
  options: RunDevguardOptions,
): Promise<GatewayStatus> {
  const root = resolve(projectRoot);
  try {
    await readFile(join(root, DEVGUARD_PROJECT_FILE), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Run "openclaw devguard init ." first; ${DEVGUARD_PROJECT_FILE} is missing`, {
        cause: error,
      });
    }
    throw error;
  }

  const config = await readProjectConfig(root);
  const environment = options.environment ?? process.env;
  const output = options.output ?? defaultCliOutput;
  const paths = resolveProjectPaths(root, config.plugin.id, environment);
  try {
    await readFile(join(paths.projectStateRoot, 'init.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('DevGuard isolated state is not initialized; run init again', {
        cause: error,
      });
    }
    throw error;
  }
  const gatewayToken = (
    await readFile(join(paths.projectStateRoot, 'gateway-token'), 'utf8')
  ).trim();
  if (gatewayToken.length === 0) throw new Error('DevGuard isolated Gateway token is empty');
  const gatewayUrl = `ws://127.0.0.1:${config.gateway.port}`;

  let buildSequence = 0;
  let buildId = '';
  let gatewayStatus: GatewayStatus | undefined;
  let resolveReady!: (status: GatewayStatus) => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<GatewayStatus>((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise;
    rejectReady = rejectPromise;
  });
  const isolatedEnvironment = (): NodeJS.ProcessEnv => ({
    ...environment,
    OPENCLAW_STATE_DIR: paths.stateDirectory,
    OPENCLAW_SKIP_CHANNELS: '1',
    OPENCLAW_PLUGIN_LIFECYCLE_TRACE: '1',
    OPENCLAW_DIAGNOSTICS: 'plugin.load-profile',
    DEVGUARD_BUILD_ID: buildId,
    DEVGUARD_LOG_PATH: paths.logPath,
    DEVGUARD_ENV_PREVIEW_ALLOWLIST: config.logging.environmentValueAllowlist.join(','),
  });

  const runner = createDevRunner({
    startBuild: () =>
      spawn(config.plugin.build.command, config.plugin.build.args, {
        cwd: root,
        env: environment,
        stdio: 'inherit',
      }),
    startGateway: () => {
      const args = ['gateway', 'run', '--port', String(config.gateway.port)];
      if (options.unsafeRawStream) {
        args.push(
          '--raw-stream',
          '--raw-stream-path',
          join(paths.projectStateRoot, 'logs', 'raw-stream.jsonl'),
        );
      }
      return spawn('openclaw', args, {
        cwd: root,
        env: isolatedEnvironment(),
        stdio: 'inherit',
      });
    },
    onBuildStarted() {
      logDebug(options.logger, `build started for ${config.plugin.id}`);
      recordRuntimeEvent(
        paths.logPath,
        {
          event: 'build_started',
          pluginId: config.plugin.id,
        },
        options.logger,
      );
    },
    onBuildSucceeded() {
      buildSequence += 1;
      buildId = `${new Date().toISOString()}#${buildSequence}`;
      logInfo(options.logger, `build succeeded for ${config.plugin.id} (${buildId})`);
      recordRuntimeEvent(
        paths.logPath,
        {
          event: 'build_succeeded',
          pluginId: config.plugin.id,
          pluginBuildId: buildId,
        },
        options.logger,
      );
    },
    onGatewayStarted(child: ChildProcess) {
      const expectedBuildId = buildId;
      logDebug(
        options.logger,
        `Gateway process started for ${config.plugin.id} (pid ${child.pid ?? 'unknown'})`,
      );
      recordRuntimeEvent(
        paths.logPath,
        {
          event: 'gateway_started',
          pluginId: config.plugin.id,
          pluginBuildId: expectedBuildId,
          gatewayProcessId: child.pid,
        },
        options.logger,
      );
      void waitForGatewayStatus({
        expectedBuildId,
        isCurrent: () => buildId === expectedBuildId,
        queryStatus: () =>
          callGatewayFromCli(
            'devguard.status',
            { json: true, timeout: '2000', token: gatewayToken, url: gatewayUrl },
            {},
            { deviceIdentity: null, progress: false },
          ),
        timeoutMs: options.startupTimeoutMs ?? 20_000,
      }).then(
        (status) => {
          if (!status || buildId !== expectedBuildId) return;
          gatewayStatus = status;
          logInfo(
            options.logger,
            `Gateway verified for ${config.plugin.id} (${status.pluginBuildId ?? 'unknown'})`,
          );
          output.writeStdout(
            `DevGuard ready: build ${status.pluginBuildId ?? 'unknown'}, hook active, log ${status.logPath ?? paths.logPath}\n`,
          );
          resolveReady(status);
        },
        (error) => {
          if (buildId !== expectedBuildId) return;
          recordRuntimeEvent(
            paths.logPath,
            {
              event: 'gateway_start_failed',
              pluginId: config.plugin.id,
              pluginBuildId: expectedBuildId,
              error: reportError(options.logger, 'Gateway startup failed', error),
            },
            options.logger,
          );
          rejectReady(error);
        },
      );
    },
    onBuildError(error) {
      const message = reportError(options.logger, 'build failed', error);
      recordRuntimeEvent(
        paths.logPath,
        {
          event: 'build_failed',
          pluginId: config.plugin.id,
          error: message,
        },
        options.logger,
      );
      rejectReady(error);
    },
  });

  const watcher = await createProjectWatcher({
    root,
    paths: config.plugin.watch,
    onChange: ({ event, path }) => {
      logDebug(options.logger, `watch event ${event}: ${path}`);
      runner.requestBuild();
    },
    onError: (error) => {
      reportError(options.logger, 'project watcher failed', error);
    },
  });
  logDebug(
    options.logger,
    `watching ${config.plugin.watch.length} configured path${config.plugin.watch.length === 1 ? '' : 's'} for ${config.plugin.id}`,
  );

  const shutdown = async (): Promise<void> => {
    logDebug(options.logger, `stopping supervision for ${config.plugin.id}`);
    await watcher.close();
    await runner.stop();
  };
  runner.requestBuild();

  try {
    const initialStatus = await ready;
    if (options.once) {
      await shutdown();
      return initialStatus;
    }

    await new Promise<void>((resolveSignal) => {
      const finish = (): void => resolveSignal();
      process.once('SIGINT', finish);
      process.once('SIGTERM', finish);
    });
    await shutdown();
    return gatewayStatus ?? initialStatus;
  } catch (error) {
    await shutdown();
    throw error;
  }
}
