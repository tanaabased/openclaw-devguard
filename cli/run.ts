import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { callGatewayFromCli } from 'openclaw/plugin-sdk/gateway-runtime';

import createDevRunner, {
  DEVGUARD_MANAGED_RUNTIME_ENV,
  type GatewayExit,
} from '../lib/dev-runner.ts';
import {
  defaultCliOutput,
  formatCliField,
  formatCliStatus,
  formatCliTarget,
  type CliOutput,
  writeCliLines,
} from '../lib/cli-output.ts';
import waitForGatewayStatus, { type GatewayStatus } from '../lib/gateway-status.ts';
import { logDebug, logInfo, type Logger, reportError } from '../lib/logger.ts';
import createProjectWatcher from '../lib/project-watcher.ts';
import { findProjectRoot, readProjectConfig, resolveProjectPaths } from '../lib/project-config.ts';
import createRuntimeEventRecorder from '../lib/runtime-events.ts';
import isolatedOpenClawEnvironment, {
  openClawProfileArguments,
} from '../utils/isolated-openclaw-environment.ts';
import parseRestoreMarker from '../utils/restore-marker.ts';

const DEFAULT_GATEWAY_STARTUP_TIMEOUT_MS = 60_000;

export interface RunDevguardOptions {
  environment?: NodeJS.ProcessEnv;
  logger: Logger;
  once?: boolean;
  output?: CliOutput;
  unsafeRawStream?: boolean;
  startupTimeoutMs?: number;
}

function unexpectedGatewayExit(exit: GatewayExit): Error {
  if (exit.error !== undefined) {
    return new Error('DevGuard Gateway process failed unexpectedly', { cause: exit.error });
  }
  if (exit.signal) {
    return new Error(`DevGuard Gateway exited unexpectedly with signal ${exit.signal}`);
  }
  return new Error(`DevGuard Gateway exited unexpectedly with code ${String(exit.code)}`);
}

export default async function runDevguard(
  projectRoot: string,
  options: RunDevguardOptions,
): Promise<GatewayStatus> {
  const root = await findProjectRoot(projectRoot);
  const config = await readProjectConfig(root);
  const environment = options.environment ?? process.env;
  const output = options.output ?? defaultCliOutput;
  const paths = resolveProjectPaths(root, config.plugin.id, environment);
  const runId = randomUUID();
  const events = createRuntimeEventRecorder({
    base: { pluginId: config.plugin.id, runId },
    logPath: paths.logPath,
    onError: (error) => reportError(options.logger, 'could not append a lifecycle event', error),
  });
  try {
    parseRestoreMarker(
      JSON.parse(await readFile(join(paths.projectStateRoot, 'init.json'), 'utf8')),
      paths.projectStateRoot,
      paths.stateDirectory,
      paths.profileName,
    );
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
  let activeGatewayBuildId: string | undefined;
  let gatewayStatus: GatewayStatus | undefined;
  let resolveReady!: (status: GatewayStatus) => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<GatewayStatus>((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise;
    rejectReady = rejectPromise;
  });
  let resolveGatewayFailure!: (error: Error) => void;
  const gatewayFailure = new Promise<Error>((resolvePromise) => {
    resolveGatewayFailure = resolvePromise;
  });
  const isolatedEnvironment = (): NodeJS.ProcessEnv =>
    isolatedOpenClawEnvironment(
      environment,
      { profileName: paths.profileName, stateDirectory: paths.stateDirectory },
      {
        OPENCLAW_SKIP_CHANNELS: '1',
        OPENCLAW_PLUGIN_LIFECYCLE_TRACE: '1',
        OPENCLAW_DIAGNOSTICS: 'plugin.load-profile',
        [DEVGUARD_MANAGED_RUNTIME_ENV]: '1',
        DEVGUARD_BUILD_ID: buildId,
        DEVGUARD_LOG_PATH: paths.logPath,
        DEVGUARD_TARGET_PLUGIN_ID: config.plugin.id,
        DEVGUARD_POLICY_MODE: config.policy.mode,
        DEVGUARD_ENV_PREVIEW_ALLOWLIST: config.logging.environmentValueAllowlist.join(','),
      },
    );
  const validation = config.plugin.validate;

  const runner = createDevRunner({
    startBuild: () =>
      spawn(config.plugin.build.command, config.plugin.build.args, {
        cwd: root,
        env: environment,
        stdio: 'inherit',
      }),
    startValidation: validation
      ? () =>
          spawn(validation.command, validation.args, {
            cwd: root,
            env: environment,
            stdio: 'inherit',
          })
      : undefined,
    startGateway: () => {
      const args = ['gateway', 'run', '--port', String(config.gateway.port)];
      if (options.unsafeRawStream) {
        args.push(
          '--raw-stream',
          '--raw-stream-path',
          join(paths.projectStateRoot, 'logs', 'raw-stream.jsonl'),
        );
      }
      return spawn('openclaw', openClawProfileArguments(paths.profileName, args), {
        cwd: root,
        env: isolatedEnvironment(),
        stdio: 'inherit',
      });
    },
    onBuildStarted() {
      logDebug(options.logger, `build started for ${config.plugin.id}`);
      events.record({ event: 'build_started' });
    },
    onBuildSucceeded() {
      activeGatewayBuildId = undefined;
      buildSequence += 1;
      buildId = `${new Date().toISOString()}#${buildSequence}`;
      logInfo(options.logger, `build succeeded for ${config.plugin.id} (${buildId})`);
      events.record({ event: 'build_succeeded', pluginBuildId: buildId });
    },
    onValidationStarted() {
      logDebug(options.logger, `validation started for ${config.plugin.id}`);
      events.record({ event: 'plugin_validation_started' });
    },
    onValidationSucceeded() {
      logInfo(options.logger, `validation succeeded for ${config.plugin.id}`);
      events.record({ event: 'plugin_validation_succeeded' });
    },
    onValidationError(error) {
      const message = reportError(options.logger, 'plugin validation failed', error);
      events.record({ event: 'plugin_validation_failed', error: message });
      rejectReady(error);
    },
    onGatewayRestartRequested() {
      events.record({
        event: 'gateway_restart_requested',
        pluginBuildId: buildId,
        previousPluginBuildId: gatewayStatus?.pluginBuildId,
      });
    },
    onGatewayStarted(child: ChildProcess) {
      const expectedBuildId = buildId;
      activeGatewayBuildId = expectedBuildId;
      logDebug(
        options.logger,
        `Gateway process started for ${config.plugin.id} (pid ${child.pid ?? 'unknown'})`,
      );
      events.record({
        event: 'gateway_started',
        pluginBuildId: expectedBuildId,
        gatewayProcessId: child.pid,
      });
      void waitForGatewayStatus({
        expectedBuildId,
        expectedPolicyMode: config.policy.mode,
        expectedProfileName: paths.profileName,
        expectedStateDirectory: paths.stateDirectory,
        isCurrent: () => activeGatewayBuildId === expectedBuildId,
        queryStatus: () =>
          callGatewayFromCli(
            'devguard.status',
            { json: true, timeout: '2000', token: gatewayToken, url: gatewayUrl },
            {},
            { deviceIdentity: null, progress: false },
          ),
        timeoutMs: options.startupTimeoutMs ?? DEFAULT_GATEWAY_STARTUP_TIMEOUT_MS,
      }).then(
        (status) => {
          if (!status || activeGatewayBuildId !== expectedBuildId) return;
          gatewayStatus = status;
          logInfo(
            options.logger,
            `Gateway verified for ${config.plugin.id} (${status.pluginBuildId ?? 'unknown'})`,
          );
          events.record({
            event: 'target_plugin_loaded',
            pluginBuildId: status.pluginBuildId,
            gatewayProcessId: status.gatewayProcessId,
          });
          writeCliLines(output, [
            formatCliStatus('ready', config.plugin.id),
            formatCliTarget('profile', paths.profileName),
            formatCliTarget('build', status.pluginBuildId ?? 'unknown'),
            formatCliField('hook', 'active'),
            formatCliTarget('log', status.logPath ?? paths.logPath),
          ]);
          resolveReady(status);
        },
        (error) => {
          if (activeGatewayBuildId !== expectedBuildId) return;
          const message = reportError(options.logger, 'Gateway startup failed', error);
          events.record({
            event: 'target_plugin_load_failed',
            pluginBuildId: expectedBuildId,
            error: message,
          });
          events.record({
            event: 'gateway_start_failed',
            pluginBuildId: expectedBuildId,
            error: message,
          });
          rejectReady(error);
        },
      );
    },
    onGatewayStartError(error) {
      const message = reportError(options.logger, 'Gateway startup failed', error);
      events.record({ event: 'gateway_start_failed', pluginBuildId: buildId, error: message });
      rejectReady(error);
      resolveGatewayFailure(error instanceof Error ? error : new Error(String(error)));
    },
    onGatewayExit(exit) {
      activeGatewayBuildId = undefined;
      const error = unexpectedGatewayExit(exit);
      const message = reportError(options.logger, 'Gateway exited', error);
      events.record({
        event: 'gateway_exited',
        pluginBuildId: buildId,
        exitCode: exit.code,
        exitSignal: exit.signal,
        error: message,
      });
      rejectReady(error);
      resolveGatewayFailure(error);
    },
    onBuildError(error) {
      const message = reportError(options.logger, 'build failed', error);
      events.record({ event: 'build_failed', error: message });
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
    await events.flush();
  };
  runner.requestBuild();

  try {
    const initialStatus = await ready;
    if (options.once) {
      await shutdown();
      return initialStatus;
    }

    let removeSignalListeners = (): void => undefined;
    const terminationSignal = new Promise<void>((resolveSignal) => {
      const finish = (): void => resolveSignal();
      process.once('SIGINT', finish);
      process.once('SIGTERM', finish);
      removeSignalListeners = () => {
        process.removeListener('SIGINT', finish);
        process.removeListener('SIGTERM', finish);
      };
    });
    const gatewayError = await Promise.race([
      terminationSignal.then(() => undefined),
      gatewayFailure,
    ]);
    removeSignalListeners();
    if (gatewayError) throw gatewayError;
    await shutdown();
    return gatewayStatus ?? initialStatus;
  } catch (error) {
    await shutdown();
    throw error;
  }
}
