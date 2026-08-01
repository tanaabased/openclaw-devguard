import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { callGatewayFromCli } from 'openclaw/plugin-sdk/gateway-runtime';

import {
  defaultCliOutput,
  formatCliError,
  formatCliField,
  formatCliStatus,
  type CliOutput,
  type CliStyles,
  writeCliLines,
} from '../lib/cli-output.ts';
import { parseGatewayStatus, type GatewayStatus } from '../lib/gateway-status.ts';
import { type Logger, reportError } from '../lib/logger.ts';
import processCommand, {
  type ProcessCommandOptions,
  type ProcessCommandResult,
} from '../lib/process-command.ts';
import { findProjectRoot, readProjectConfig, resolveProjectPaths } from '../lib/project-config.ts';
import createRuntimeEventRecorder from '../lib/runtime-events.ts';
import { readSupervisorOwner, type SupervisorOwner } from '../lib/supervisor-ownership.ts';
import warnIfAuditLogLarge from '../utils/audit-log-size.ts';
import doctorChecks, { latestSuccessfulBuildId } from '../utils/doctor-checks.ts';
import inspectGatewayPort from '../utils/gateway-port.ts';
import isolatedOpenClawEnvironment, {
  openClawProfileArguments,
} from '../utils/isolated-openclaw-environment.ts';
import inspectPrivateArtifact, {
  repairPrivateArtifact,
  type PrivateArtifactKind,
} from '../utils/private-artifact.ts';
import parsePluginRuntimeInspection, {
  type PluginRuntimeInspection,
} from '../utils/plugin-runtime-inspection.ts';
import parseRestoreMarker from '../utils/restore-marker.ts';
import assertSupportedHost from '../utils/supported-host.ts';

const DEVGUARD_PLUGIN_ID = 'openclaw-devguard';

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
  fixPermissions?: boolean;
  inspectPort?: typeof inspectGatewayPort;
  json?: boolean;
  logger: Logger;
  output?: CliOutput;
  platform?: NodeJS.Platform;
  queryStatus?: (options: { token: string; url: string }) => Promise<unknown>;
  runCommand?: DoctorCommand;
  styles?: CliStyles;
}

interface PrivateArtifact {
  kind: PrivateArtifactKind;
  path: string;
}

interface PermissionReport {
  issues: string[];
  repaired: string[];
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

function commandRuntimeInspection(
  result: Attempt<ProcessCommandResult>,
  pluginId: string,
): Attempt<PluginRuntimeInspection> {
  if (!result.value) return { error: result.error };
  if (result.value.code !== 0) {
    return {
      error: commandDetail(
        result.value,
        `runtime inspection for ${pluginId} exited ${result.value.code}`,
      ),
    };
  }
  try {
    return {
      value: parsePluginRuntimeInspection(JSON.parse(result.value.output), pluginId),
    };
  } catch (error) {
    return {
      error: `could not validate OpenClaw runtime inspection for ${pluginId}: ${errorMessage(error)}`,
    };
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

function isWithin(root: string, path: string): boolean {
  const child = relative(resolve(root), resolve(path));
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function privateArtifacts(
  projectStateRoot: string,
  stateDirectory: string,
  logPath: string,
  agents: unknown,
): PrivateArtifact[] {
  const agentRoot = join(stateDirectory, 'agents');
  const agentDirectories = Array.isArray(agents)
    ? agents.flatMap((value): PrivateArtifact[] => {
        if (value === null || Array.isArray(value) || typeof value !== 'object') return [];
        const agentDir = (value as Record<string, unknown>).agentDir;
        if (typeof agentDir !== 'string' || !isAbsolute(agentDir)) return [];
        return isWithin(agentRoot, agentDir) ? [{ kind: 'directory', path: agentDir }] : [];
      })
    : [];
  const artifacts: PrivateArtifact[] = [
    { kind: 'directory', path: projectStateRoot },
    { kind: 'directory', path: stateDirectory },
    { kind: 'directory', path: dirname(logPath) },
    { kind: 'file', path: join(projectStateRoot, 'gateway-token') },
    { kind: 'file', path: join(projectStateRoot, 'init.json') },
    { kind: 'file', path: join(projectStateRoot, 'openclaw.before-devguard.json') },
    { kind: 'file', path: join(projectStateRoot, 'supervisor.json') },
    { kind: 'file', path: join(projectStateRoot, 'supervisor.json.lock') },
    { kind: 'file', path: logPath },
    { kind: 'file', path: join(projectStateRoot, 'logs', 'raw-stream.jsonl') },
    { kind: 'file', path: join(stateDirectory, 'openclaw.json') },
    ...agentDirectories,
  ];
  return [
    ...new Map(
      artifacts.map((artifact) => [`${artifact.kind}:${artifact.path}`, artifact]),
    ).values(),
  ];
}

function supervisorOwnerStatus(
  owner: Attempt<SupervisorOwner | undefined>,
  projectRoot: string,
  profileName: string,
  port: number,
): { detail?: string; ok: boolean } {
  if (owner.error) return { detail: owner.error, ok: false };
  if (!owner.value) return { detail: 'no active DevGuard supervisor owns this project', ok: false };

  const mismatches = [
    ...(owner.value.projectRoot === projectRoot ? [] : ['project']),
    ...(owner.value.profileName === profileName ? [] : ['profile']),
    ...(owner.value.port === port ? [] : ['port']),
  ];
  return mismatches.length === 0
    ? { ok: true }
    : {
        detail: `owner pid ${owner.value.pid} does not match the expected ${mismatches.join(', ')}`,
        ok: false,
      };
}

async function inspectArtifactPermissions(
  artifacts: readonly PrivateArtifact[],
  fixPermissions: boolean,
): Promise<PermissionReport> {
  const initial = await Promise.all(
    artifacts.map(({ kind, path }) => inspectPrivateArtifact(path, kind)),
  );
  const repaired: string[] = [];
  const repairErrors: string[] = [];
  if (fixPermissions) {
    for (const status of initial) {
      if (!status.exists || !status.issue || status.mode === undefined) continue;
      try {
        const result = await repairPrivateArtifact(status.path, status.kind);
        if (!result.issue) repaired.push(status.path);
      } catch (error) {
        repairErrors.push(
          `${status.path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  const final = await Promise.all(
    artifacts.map(({ kind, path }) => inspectPrivateArtifact(path, kind)),
  );
  return {
    repaired,
    issues: [
      ...final.flatMap((status) =>
        status.exists && status.issue ? [`${status.path}: ${status.issue}`] : [],
      ),
      ...repairErrors,
    ],
  };
}

export default async function doctorDevguard(
  projectRoot: string,
  options: DoctorDevguardOptions,
): Promise<void> {
  assertSupportedHost(options.platform);
  const root = await findProjectRoot(projectRoot);
  const environment = options.environment ?? process.env;
  const config = await readProjectConfig(root);
  const paths = resolveProjectPaths(root, config.plugin.id, environment);
  await warnIfAuditLogLarge({ logPath: paths.logPath, logger: options.logger });
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
    agentDefaultsConfigResult,
    agentsConfigResult,
    manifest,
    log,
    targetRuntimeInspectionResult,
    devguardRuntimeInspectionResult,
    pluginDoctor,
    token,
    supervisorOwner,
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
        openClawProfileArguments(paths.profileName, ['config', 'get', 'agents.defaults', '--json']),
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
      runCommand(
        'openclaw',
        openClawProfileArguments(paths.profileName, [
          'plugins',
          'inspect',
          DEVGUARD_PLUGIN_ID,
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
    attempt(() => readSupervisorOwner(paths.projectStateRoot)),
  ]);

  const gatewayConfig = commandJson(gatewayConfigResult);
  const toolsConfig = commandJson(toolsConfigResult);
  const agentDefaultsConfig = commandJson(agentDefaultsConfigResult);
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
    agentDefaultsConfig.value !== undefined &&
    agentsConfig.value !== undefined
      ? {
          gateway: gatewayConfig.value,
          tools: toolsConfig.value,
          agents: { defaults: agentDefaultsConfig.value, list: agentsConfig.value },
        }
      : undefined;
  const stateConfigError =
    gatewayConfig.error ?? toolsConfig.error ?? agentDefaultsConfig.error ?? agentsConfig.error;
  const permissions = await inspectArtifactPermissions(
    privateArtifacts(
      paths.projectStateRoot,
      paths.stateDirectory,
      paths.logPath,
      agentsConfig.value,
    ),
    options.fixPermissions === true,
  );

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
        }).then(parseGatewayStatus),
      )
    : { error: token.error ?? 'isolated Gateway token is empty' };
  const gatewayPort = gatewayStatus.value
    ? undefined
    : await (options.inspectPort ?? inspectGatewayPort)(config.gateway.port);
  const supervisor = supervisorOwnerStatus(
    supervisorOwner,
    root,
    paths.profileName,
    config.gateway.port,
  );
  const targetRuntimeInspection = commandRuntimeInspection(
    targetRuntimeInspectionResult,
    config.plugin.id,
  );
  const devguardRuntimeInspection = commandRuntimeInspection(
    devguardRuntimeInspectionResult,
    DEVGUARD_PLUGIN_ID,
  );
  const devguardCompatibilityWarnings = devguardRuntimeInspection.value?.compatibility.filter(
    ({ severity }) => severity === 'warn',
  );
  const openClawCompatibilityDetail =
    devguardRuntimeInspection.error ??
    (devguardRuntimeInspection.value?.cliCommands.includes('devguard')
      ? devguardCompatibilityWarnings?.map(({ message }) => message).join('; ') || undefined
      : 'OpenClaw runtime inspection does not report the devguard CLI registration');
  const doctorResult = pluginDoctor.value;
  const manifestValue = manifest.value as { id?: unknown } | undefined;
  const checks = doctorChecks({
    artifactPermissionsDetail: permissions.issues.join('; ') || undefined,
    artifactPermissionsOk: permissions.issues.length === 0,
    expectedPluginId: config.plugin.id,
    expectedPolicyMode: config.policy.mode,
    expectedPort: config.gateway.port,
    expectedProfileName: paths.profileName,
    expectedStateDirectory: paths.stateDirectory,
    gatewayError: gatewayStatus.error,
    gatewayPortDetail: gatewayStatus.value
      ? undefined
      : gatewayPort?.available
        ? 'configured port is available but no DevGuard Gateway is reachable; start devguard run'
        : `configured port is occupied without a reachable DevGuard Gateway${gatewayPort?.detail ? ` (${gatewayPort.detail})` : ''}; stop its current owner or change gateway.port`,
    gatewayPortOwned: gatewayStatus.value !== undefined,
    gatewayStatus: gatewayStatus.value as GatewayStatus | undefined,
    importedAgentIds: profileImport.value,
    initialized: marker.value !== undefined,
    latestBuildId: log.value ? latestSuccessfulBuildId(log.value) : undefined,
    manifestError: manifest.error,
    manifestId: typeof manifestValue?.id === 'string' ? manifestValue.id : undefined,
    openClawCompatibilityDetail,
    openClawCompatibilityOk:
      devguardRuntimeInspection.value !== undefined &&
      devguardRuntimeInspection.value.cliCommands.includes('devguard') &&
      devguardCompatibilityWarnings?.length === 0,
    pluginDoctorDetail: doctorResult
      ? commandDetail(doctorResult, `openclaw plugins doctor exited ${doctorResult.code}`)
      : pluginDoctor.error,
    pluginDoctorOk: doctorResult?.code === 0,
    profileImportError: profileImport.error,
    productionStateDirectory: resolve(join(homedir(), '.openclaw')),
    runtimeInspectionDetail: targetRuntimeInspection.error,
    runtimeInspectionOk: targetRuntimeInspection.value !== undefined,
    stateConfig,
    stateConfigError,
    supervisorOwnerDetail: supervisor.detail,
    supervisorOwnerOk: supervisor.ok,
  });
  const failed = checks.filter((check) => !check.ok);

  if (options.json) {
    writeCliLines(output, [
      JSON.stringify({
        ok: failed.length === 0,
        checks,
        repairedPermissions: permissions.repaired,
      }),
    ]);
  } else {
    const importedAgents = profileImport.value;
    writeCliLines(output, [
      ...checks.map((check) => {
        const heading = check.ok
          ? formatCliStatus('pass', check.label, options.styles)
          : formatCliError('error', check.label, options.styles);
        return !check.ok && check.detail ? `${heading} ${check.detail}` : heading;
      }),
      ...(importedAgents
        ? [formatCliField('agents', importedAgents.join(', '), options.styles)]
        : []),
      ...(options.fixPermissions
        ? [
            formatCliField(
              'permissions',
              permissions.repaired.length === 0
                ? 'unchanged'
                : `${permissions.repaired.length} repaired`,
              options.styles,
            ),
          ]
        : []),
    ]);
  }

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
