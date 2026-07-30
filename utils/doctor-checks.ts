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
  profileName?: string;
  stateDirectory?: string;
}

export interface DoctorCheckInput {
  artifactPermissionsDetail?: string;
  artifactPermissionsOk: boolean;
  expectedPluginId: string;
  expectedPolicyMode: string;
  expectedPort: number;
  expectedProfileName: string;
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

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return undefined;
  return value as Record<string, unknown>;
}

function configuredModelRefs(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  const model = recordValue(value);
  if (!model) return [];
  const fallbacks = Array.isArray(model.fallbacks)
    ? model.fallbacks.filter((fallback): fallback is string => typeof fallback === 'string')
    : [];
  return [...(typeof model.primary === 'string' ? [model.primary] : []), ...fallbacks];
}

function incompatibleOpenAiRuntimeRefs(
  stateConfig: unknown,
  importedAgentIds: readonly string[],
): string[] {
  const defaults = recordValue(nestedValue(stateConfig, ['agents', 'defaults']));
  const defaultModels = recordValue(defaults?.models);
  const configuredAgents = nestedValue(stateConfig, ['agents', 'list']);
  if (!Array.isArray(configuredAgents)) return [];

  return [
    ...new Set(
      configuredAgents.flatMap((value) => {
        const agent = recordValue(value);
        if (!agent || typeof agent.id !== 'string' || !importedAgentIds.includes(agent.id))
          return [];
        const agentModels = recordValue(agent.models);
        return configuredModelRefs(agent.model ?? defaults?.model).filter((ref) => {
          if (!ref.startsWith('openai/')) return false;
          const entry = recordValue(agentModels?.[ref] ?? defaultModels?.[ref]);
          return nestedValue(entry, ['agentRuntime', 'id']) !== 'openclaw';
        });
      }),
    ),
  ];
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
  const sandboxDisabled =
    nestedValue(stateConfig, ['agents', 'defaults', 'sandbox', 'mode']) === 'off';
  const elevatedDisabled = nestedValue(stateConfig, ['tools', 'elevated', 'enabled']) === false;
  const execReachesGuard = nestedValue(stateConfig, ['tools', 'exec', 'mode']) === 'full';
  const configuredAgents = nestedValue(stateConfig, ['agents', 'list']);
  const importedAgentIds = input.importedAgentIds ?? [];
  const incompatibleRuntimeRefs = incompatibleOpenAiRuntimeRefs(stateConfig, importedAgentIds);
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
      'artifact-permissions',
      'private artifact permissions',
      input.artifactPermissionsOk,
      input.artifactPermissionsDetail,
    ),
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
    check(
      'profile-selected',
      'native profile selected',
      status?.profileName === input.expectedProfileName,
      status?.profileName,
    ),
    check('state-config', 'state configuration', stateConfig !== undefined, input.stateConfigError),
    check(
      'gateway-config',
      'local gateway',
      gatewayConfigured,
      'expected token-auth loopback gateway',
    ),
    check(
      'sandbox-disabled',
      'docker sandbox disabled',
      sandboxDisabled,
      'expected sandbox mode off',
    ),
    check('elevated-disabled', 'elevated disabled', elevatedDisabled),
    check('exec-pipeline-open', 'exec reaches guard', execReachesGuard, 'expected exec mode full'),
    check(
      'openai-runtime-compatible',
      'openai tools use openclaw runtime',
      incompatibleRuntimeRefs.length === 0,
      incompatibleRuntimeRefs.join(', ') || undefined,
    ),
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
      'policy hook active',
      status?.hookRegistered === true && status.policyMode === input.expectedPolicyMode,
      status?.policyMode,
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
