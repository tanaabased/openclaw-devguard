import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { callGatewayFromCli } from 'openclaw/plugin-sdk/gateway-runtime';

import {
  defaultCliOutput,
  formatCliError,
  formatCliStatus,
  type CliOutput,
  type CliStyles,
  writeCliLines,
} from '../lib/cli-output.ts';
import { type GatewayStatus } from '../lib/gateway-status.ts';
import { type Logger, reportError } from '../lib/logger.ts';
import processCommand, {
  type ProcessCommandOptions,
  type ProcessCommandResult,
} from '../lib/process-command.ts';
import { findProjectRoot, readProjectConfig, resolveProjectPaths } from '../lib/project-config.ts';
import createRuntimeEventRecorder from '../lib/runtime-events.ts';
import doctorChecks, { latestSuccessfulBuildId } from '../utils/doctor-checks.ts';
import isolatedOpenClawEnvironment, {
  openClawProfileArguments,
} from '../utils/isolated-openclaw-environment.ts';
import parseRestoreMarker from '../utils/restore-marker.ts';

interface Attempt<T> {
  error?: string;
  value?: T;
}

type DoctorCommand = (
  command: string,
  args: readonly string[],
  options?: ProcessCommandOptions,
) => Promise<ProcessCommandResult>;

export interface DoctorDevguardOptions {
  environment?: NodeJS.ProcessEnv;
  logger: Logger;
  output?: CliOutput;
  queryStatus?: (options: { token: string; url: string }) => Promise<unknown>;
  runCommand?: DoctorCommand;
  styles?: CliStyles;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function attempt<T>(operation: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { value: await operation() };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

function commandDetail(result: ProcessCommandResult | undefined, fallback: string): string {
  const output = result?.output.trim();
  return output || fallback;
}

function commandJson(result: Attempt<ProcessCommandResult>): Attempt<unknown> {
  if (!result.value) return { error: result.error };
  if (result.value.code !== 0) {
    return {
      error: commandDetail(result.value, `config command exited ${result.value.code}`),
    };
  }
  try {
    return { value: JSON.parse(result.value.output) };
  } catch (error) {
    return { error: `could not parse OpenClaw config output: ${errorMessage(error)}` };
  }
}

function importedAgentIds(
  marker: Attempt<string>,
  projectStateRoot: string,
  stateDirectory: string,
  profileName: string,
): Attempt<string[]> {
  if (!marker.value) return { error: marker.error ?? 'initialization marker is missing' };
  try {
    const value = JSON.parse(marker.value) as {
      profileImport?: { agentIds?: unknown };
    };
    parseRestoreMarker(value, projectStateRoot, stateDirectory, profileName);
    const agentIds = value.profileImport?.agentIds;
    if (!Array.isArray(agentIds) || agentIds.some((agentId) => typeof agentId !== 'string')) {
      return { error: 'initialization marker does not contain imported agents' };
    }
    return { value: agentIds };
  } catch (error) {
    return { error: `could not parse initialization marker: ${errorMessage(error)}` };
  }
}

export default async function doctorDevguard(
  projectRoot: string,
  options: DoctorDevguardOptions,
): Promise<void> {
  const root = await findProjectRoot(projectRoot);
  const environment = options.environment ?? process.env;
  const config = await readProjectConfig(root);
  const paths = resolveProjectPaths(root, config.plugin.id, environment);
  const isolatedEnvironment = isolatedOpenClawEnvironment(
    environment,
    { profileName: paths.profileName, stateDirectory: paths.stateDirectory },
    { OPENCLAW_SKIP_CHANNELS: '1' },
  );
  const runCommand = options.runCommand ?? processCommand;
  const output = options.output ?? defaultCliOutput;
  const events = createRuntimeEventRecorder({
    base: { pluginId: config.plugin.id, runId: randomUUID() },
    logPath: paths.logPath,
    onError: (error) => reportError(options.logger, 'could not append a doctor event', error),
  });

  const [
    marker,
    gatewayConfigResult,
    toolsConfigResult,
    sandboxConfigResult,
    agentsConfigResult,
    manifest,
    log,
    runtimeInspection,
    pluginDoctor,
    token,
  ] = await Promise.all([
    attempt(() => readFile(join(paths.projectStateRoot, 'init.json'), 'utf8')),
    attempt(() =>
      runCommand(
        'openclaw',
        openClawProfileArguments(paths.profileName, ['config', 'get', 'gateway', '--json']),
        {
          allowFailure: true,
          env: isolatedEnvironment,
        },
      ),
    ),
    attempt(() =>
      runCommand(
        'openclaw',
        openClawProfileArguments(paths.profileName, ['config', 'get', 'tools', '--json']),
        {
          allowFailure: true,
          env: isolatedEnvironment,
        },
      ),
    ),
    attempt(() =>
      runCommand(
        'openclaw',
        openClawProfileArguments(paths.profileName, [
          'config',
          'get',
          'agents.defaults.sandbox',
          '--json',
        ]),
        {
          allowFailure: true,
          env: isolatedEnvironment,
        },
      ),
    ),
    attempt(() =>
      runCommand(
        'openclaw',
        openClawProfileArguments(paths.profileName, ['config', 'get', 'agents.list', '--json']),
        {
          allowFailure: true,
          env: isolatedEnvironment,
        },
      ),
    ),
    attempt(async () => JSON.parse(await readFile(join(root, 'openclaw.plugin.json'), 'utf8'))),
    attempt(() => readFile(paths.logPath, 'utf8')),
    attempt(() =>
      runCommand(
        'openclaw',
        openClawProfileArguments(paths.profileName, [
          'plugins',
          'inspect',
          config.plugin.id,
          '--runtime',
          '--json',
        ]),
        {
          allowFailure: true,
          env: isolatedEnvironment,
        },
      ),
    ),
    attempt(() =>
      runCommand('openclaw', openClawProfileArguments(paths.profileName, ['plugins', 'doctor']), {
        allowFailure: true,
        env: isolatedEnvironment,
      }),
    ),
    attempt(async () =>
      (await readFile(join(paths.projectStateRoot, 'gateway-token'), 'utf8')).trim(),
    ),
  ]);

  const gatewayConfig = commandJson(gatewayConfigResult);
  const toolsConfig = commandJson(toolsConfigResult);
  const sandboxConfig = commandJson(sandboxConfigResult);
  const agentsConfig = commandJson(agentsConfigResult);
  const profileImport = importedAgentIds(
    marker,
    paths.projectStateRoot,
    paths.stateDirectory,
    paths.profileName,
  );
  const stateConfig =
    gatewayConfig.value !== undefined &&
    toolsConfig.value !== undefined &&
    sandboxConfig.value !== undefined &&
    agentsConfig.value !== undefined
      ? {
          gateway: gatewayConfig.value,
          tools: toolsConfig.value,
          agents: { defaults: { sandbox: sandboxConfig.value }, list: agentsConfig.value },
        }
      : undefined;
  const stateConfigError =
    gatewayConfig.error ?? toolsConfig.error ?? sandboxConfig.error ?? agentsConfig.error;

  const queryStatus =
    options.queryStatus ??
    ((query: { token: string; url: string }) =>
      callGatewayFromCli(
        'devguard.status',
        { json: true, timeout: '2000', token: query.token, url: query.url },
        {},
        { deviceIdentity: null, progress: false },
      ));
  const gatewayToken = token.value;
  const gatewayStatus = gatewayToken
    ? await attempt(() =>
        queryStatus({
          token: gatewayToken,
          url: `ws://127.0.0.1:${config.gateway.port}`,
        }),
      )
    : { error: token.error ?? 'isolated Gateway token is empty' };
  const runtimeResult = runtimeInspection.value;
  const doctorResult = pluginDoctor.value;
  const manifestValue = manifest.value as { id?: unknown } | undefined;
  const checks = doctorChecks({
    expectedPluginId: config.plugin.id,
    expectedPolicyMode: config.policy.mode,
    expectedPort: config.gateway.port,
    expectedProfileName: paths.profileName,
    expectedStateDirectory: paths.stateDirectory,
    gatewayError: gatewayStatus.error,
    gatewayStatus: gatewayStatus.value as GatewayStatus | undefined,
    importedAgentIds: profileImport.value,
    initialized: marker.value !== undefined,
    latestBuildId: log.value ? latestSuccessfulBuildId(log.value) : undefined,
    manifestError: manifest.error,
    manifestId: typeof manifestValue?.id === 'string' ? manifestValue.id : undefined,
    pluginDoctorDetail: doctorResult
      ? commandDetail(doctorResult, `openclaw plugins doctor exited ${doctorResult.code}`)
      : pluginDoctor.error,
    pluginDoctorOk: doctorResult?.code === 0,
    profileImportError: profileImport.error,
    productionStateDirectory: resolve(join(homedir(), '.openclaw')),
    runtimeInspectionDetail: runtimeResult
      ? commandDetail(runtimeResult, `runtime inspection exited ${runtimeResult.code}`)
      : runtimeInspection.error,
    runtimeInspectionOk: runtimeResult?.code === 0,
    stateConfig,
    stateConfigError,
  });
  const failed = checks.filter((check) => !check.ok);

  writeCliLines(
    output,
    checks.map((check) => {
      const heading = check.ok
        ? formatCliStatus('pass', check.label, options.styles)
        : formatCliError('error', check.label, options.styles);
      return !check.ok && check.detail ? `${heading} ${check.detail}` : heading;
    }),
  );

  for (const check of failed) {
    events.record({
      event: 'doctor_check_failed',
      checkId: check.id,
      reason: check.detail ?? check.label,
    });
  }
  if (failed.length === 0) events.record({ event: 'doctor_check_succeeded' });
  await events.flush();

  if (failed.length > 0) {
    throw new Error(
      `${failed.length} DevGuard doctor check${failed.length === 1 ? '' : 's'} failed`,
    );
  }
}
