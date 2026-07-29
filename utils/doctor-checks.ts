export interface DoctorCheck {
  detail?: string;
  id: string;
  label: string;
  ok: boolean;
}

export interface DoctorGatewayStatus {
  ambientChannelsDisabled?: boolean;
  denyUnknownTools?: boolean;
  hookRegistered?: boolean;
  pluginBuildId?: string;
  pluginId?: string;
  policyMode?: string;
  stateDirectory?: string;
}

export interface DoctorCheckInput {
  expectedPluginId: string;
  expectedPort: number;
  expectedStateDirectory: string;
  gatewayError?: string;
  gatewayStatus?: DoctorGatewayStatus;
  importedAgentIds?: string[];
  initialized: boolean;
  latestBuildId?: string;
  manifestError?: string;
  manifestId?: string;
  pluginDoctorDetail?: string;
  pluginDoctorOk: boolean;
  profileImportError?: string;
  productionStateDirectory: string;
  runtimeInspectionDetail?: string;
  runtimeInspectionOk: boolean;
  stateConfig?: unknown;
  stateConfigError?: string;
}

function nestedValue(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (current === null || Array.isArray(current) || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function check(id: string, label: string, ok: boolean, detail?: string): DoctorCheck {
  return { id, label, ok, ...(detail ? { detail } : {}) };
}

/** Evaluates DevGuard-owned safety invariants without reimplementing OpenClaw diagnostics. */
export default function doctorChecks(input: DoctorCheckInput): DoctorCheck[] {
  const status = input.gatewayStatus;
  const stateConfig = input.stateConfig;
  const isolated = input.expectedStateDirectory !== input.productionStateDirectory;
  const gatewayConfigured =
    nestedValue(stateConfig, ['gateway', 'mode']) === 'local' &&
    nestedValue(stateConfig, ['gateway', 'bind']) === 'loopback' &&
    nestedValue(stateConfig, ['gateway', 'auth', 'mode']) === 'token' &&
    nestedValue(stateConfig, ['gateway', 'port']) === input.expectedPort;
  const sandboxEnabled =
    nestedValue(stateConfig, ['agents', 'defaults', 'sandbox', 'mode']) === 'all';
  const workspaceDenied =
    nestedValue(stateConfig, ['agents', 'defaults', 'sandbox', 'workspaceAccess']) === 'none';
  const elevatedDisabled = nestedValue(stateConfig, ['tools', 'elevated', 'enabled']) === false;
  const execDenied = nestedValue(stateConfig, ['tools', 'exec', 'mode']) === 'deny';
  const configuredAgents = nestedValue(stateConfig, ['agents', 'list']);
  const importedAgentIds = input.importedAgentIds ?? [];
  const agentStateIsolated =
    Array.isArray(configuredAgents) &&
    importedAgentIds.length > 0 &&
    importedAgentIds.every((agentId) =>
      configuredAgents.some((value) => {
        if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
        const agent = value as Record<string, unknown>;
        return (
          agent.id === agentId &&
          typeof agent.agentDir === 'string' &&
          agent.agentDir.startsWith(`${input.expectedStateDirectory}/agents/`)
        );
      }),
    );

  return [
    check('initialized', 'initialized state', input.initialized, 'run devguard init first'),
    check(
      'profile-import',
      'source profile imported',
      importedAgentIds.length > 0,
      input.profileImportError ?? 'run devguard init again',
    ),
    check(
      'agent-state-isolated',
      'agent state isolated',
      agentStateIsolated,
      importedAgentIds.join(', ') || undefined,
    ),
    check('profile-isolated', 'isolated profile', isolated, input.expectedStateDirectory),
    check('state-config', 'state configuration', stateConfig !== undefined, input.stateConfigError),
    check(
      'gateway-config',
      'local gateway',
      gatewayConfigured,
      'expected token-auth loopback gateway',
    ),
    check('sandbox-enabled', 'sandbox enabled', sandboxEnabled, 'expected sandbox mode all'),
    check(
      'workspace-denied',
      'workspace denied',
      workspaceDenied,
      'expected workspace access none',
    ),
    check('elevated-disabled', 'elevated disabled', elevatedDisabled),
    check('exec-denied', 'exec denied', execDenied),
    check('gateway-reachable', 'gateway reachable', status !== undefined, input.gatewayError),
    check(
      'profile-active',
      'isolated profile active',
      status?.stateDirectory === input.expectedStateDirectory,
      status?.stateDirectory,
    ),
    check('channels-disabled', 'channels disabled', status?.ambientChannelsDisabled === true),
    check(
      'guard-active',
      'deny hook active',
      status?.hookRegistered === true && status.policyMode === 'deny',
    ),
    check('unknown-tools-denied', 'unknown tools denied', status?.denyUnknownTools === true),
    check(
      'target-id',
      'target plugin id',
      input.manifestId === input.expectedPluginId,
      input.manifestError ?? input.manifestId,
    ),
    check(
      'live-target-id',
      'live target plugin',
      status?.pluginId === input.expectedPluginId,
      status?.pluginId,
    ),
    check(
      'runtime-inspection',
      'runtime inspection',
      input.runtimeInspectionOk,
      input.runtimeInspectionDetail,
    ),
    check('plugin-doctor', 'plugin doctor', input.pluginDoctorOk, input.pluginDoctorDetail),
    check(
      'build-current',
      'current plugin build',
      Boolean(input.latestBuildId) && status?.pluginBuildId === input.latestBuildId,
      status?.pluginBuildId ?? input.latestBuildId,
    ),
  ];
}

export function latestSuccessfulBuildId(contents: string): string | undefined {
  const lines = contents.trimEnd().split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) continue;
    try {
      const record = JSON.parse(line) as { event?: unknown; pluginBuildId?: unknown };
      if (record.event === 'build_succeeded' && typeof record.pluginBuildId === 'string') {
        return record.pluginBuildId;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}
