import { access, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import {
  DEFAULT_PROVIDER,
  listAgentEntries,
  listAgentIds,
  loadAuthProfileStoreWithoutExternalProfiles,
  resolveAgentDir,
  resolveAgentEffectiveModelPrimary,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
  resolveEnvApiKey,
  resolvePersistedAuthProfileOwnerAgentDir,
  saveAuthProfileStore,
  type AuthProfileStore,
} from 'openclaw/plugin-sdk/agent-runtime';
import { loadConfig, type OpenClawConfig } from 'openclaw/plugin-sdk/config-runtime';

import processCommand, {
  type ProcessCommandOptions,
  type ProcessCommandResult,
} from './process-command.ts';
import {
  normalizeAgentIds,
  providerFromModelRef,
  selectAuthProfiles,
  type AuthImportSelection,
} from '../utils/profile-import.ts';
import isolatedOpenClawEnvironment from '../utils/isolated-openclaw-environment.ts';

type AgentEntry = NonNullable<NonNullable<OpenClawConfig['agents']>['list']>[number];
type AgentIdentity = NonNullable<AgentEntry['identity']>;
type AgentModelConfig = NonNullable<AgentEntry['model']>;

type ProfileImportCommand = (
  command: string,
  args: readonly string[],
  options?: ProcessCommandOptions,
) => Promise<ProcessCommandResult>;

export interface ProfileImportDependencies {
  ensureAgentDir?: (agentDir: string) => Promise<void>;
  loadAuthStore?: (agentDir: string) => AuthProfileStore;
  loadSourceConfig?: () => OpenClawConfig;
  runCommand?: ProfileImportCommand;
  saveAuthStore?: (store: AuthProfileStore, agentDir: string) => void;
}

export interface PrepareProfileImportOptions {
  agentIds?: string[];
  copyModelProfile: boolean;
  dependencies?: ProfileImportDependencies;
  destinationStateDirectory: string;
  environment: NodeJS.ProcessEnv;
}

interface PreparedAgentImport {
  default: boolean;
  destinationAgentDir: string;
  destinationAuthStore?: AuthProfileStore;
  id: string;
  identity?: AgentIdentity;
  model?: AgentModelConfig;
  modelEntries?: NonNullable<AgentEntry['models']>;
  providers: string[];
  sourceAgentDir: string;
  sourceAuthStore?: AuthProfileStore;
  workspace: string;
}

export interface PreparedProfileImport {
  agents: PreparedAgentImport[];
  copyModelProfile: boolean;
  oauthConsentProviders: string[];
  sourceConfig: OpenClawConfig;
}

export interface ResolvedAgentAuthImport {
  agentId: string;
  destinationAgentDir: string;
  selection: AuthImportSelection;
}

export interface ResolvedProfileImport {
  agentAuth: ResolvedAgentAuthImport[];
  agentIds: string[];
  auth: {
    copied: number;
    oauth: number;
    preserved: number;
    skipped: number;
  };
  configPatch: Record<string, unknown>;
  modelRefs: string[];
  workspaceIdentityImports: Array<{ agentId: string; workspace: string }>;
}

const emptyStore = (): AuthProfileStore => ({ version: 1, profiles: {} });

function defaultLoadSourceAuthStore(agentDir: string): AuthProfileStore {
  return loadAuthProfileStoreWithoutExternalProfiles(agentDir, {
    allowKeychainPrompt: false,
  });
}

function defaultLoadDestinationAuthStore(agentDir: string): AuthProfileStore {
  const inherited = loadAuthProfileStoreWithoutExternalProfiles(agentDir, {
    allowKeychainPrompt: false,
  });
  const localProfileIds = new Set(
    Object.keys(inherited.profiles).filter((profileId) => {
      const owner = resolvePersistedAuthProfileOwnerAgentDir({ agentDir, profileId });
      return owner !== undefined && resolve(owner) === resolve(agentDir);
    }),
  );
  const profiles = Object.fromEntries(
    Object.entries(inherited.profiles).filter(([profileId]) => localProfileIds.has(profileId)),
  );
  const order = Object.fromEntries(
    Object.entries(inherited.order ?? {}).flatMap(([provider, profileIds]) => {
      const selected = profileIds.filter((profileId) => localProfileIds.has(profileId));
      return selected.length > 0 ? [[provider, selected]] : [];
    }),
  );
  const lastGood = Object.fromEntries(
    Object.entries(inherited.lastGood ?? {}).filter(([, profileId]) =>
      localProfileIds.has(profileId),
    ),
  );
  const usageStats = Object.fromEntries(
    Object.entries(inherited.usageStats ?? {}).filter(([profileId]) =>
      localProfileIds.has(profileId),
    ),
  );

  return {
    version: inherited.version,
    profiles,
    ...(Object.keys(order).length > 0 ? { order } : {}),
    ...(Object.keys(lastGood).length > 0 ? { lastGood } : {}),
    ...(Object.keys(usageStats).length > 0 ? { usageStats } : {}),
  };
}

function defaultSaveAuthStore(store: AuthProfileStore, agentDir: string): void {
  saveAuthProfileStore(store, agentDir, {
    filterExternalAuthProfiles: true,
    syncExternalCli: false,
  });
}

function modelConfig(
  primary: string | undefined,
  fallbacks: string[],
): AgentModelConfig | undefined {
  if (!primary && fallbacks.length === 0) return undefined;
  if (fallbacks.length === 0) return primary;
  return { ...(primary ? { primary } : {}), fallbacks };
}

function modelRefs(model: AgentModelConfig | undefined): string[] {
  if (typeof model === 'string') return [model];
  if (!model) return [];
  return [...(model.primary ? [model.primary] : []), ...(model.fallbacks ?? [])];
}

function selectedModelEntries(
  config: OpenClawConfig,
  agentEntry: AgentEntry | undefined,
  refs: readonly string[],
): AgentEntry['models'] | undefined {
  const models = { ...config.agents?.defaults?.models, ...agentEntry?.models };
  const selected = Object.fromEntries(
    refs.flatMap((ref) => (models[ref] ? [[ref, structuredClone(models[ref])]] : [])),
  );
  return Object.keys(selected).length > 0 ? selected : undefined;
}

function hasNonOAuthAuth(
  agent: PreparedAgentImport,
  selection: AuthImportSelection,
  provider: string,
  sourceConfig: OpenClawConfig,
  environment: NodeJS.ProcessEnv,
): boolean {
  const selectedIds = [...selection.copiedProfileIds, ...selection.preservedProfileIds];
  if (
    selectedIds.some((id) => {
      const credential = selection.store.profiles[id];
      return credential?.provider === provider && credential.type !== 'oauth';
    })
  ) {
    return true;
  }
  if (sourceConfig.models?.providers?.[provider]?.apiKey !== undefined) return true;
  if (resolveEnvApiKey(provider, environment) !== null) return true;
  return selectedIds.some((id) => selection.store.profiles[id]?.provider === provider);
}

function profileConfigPatch(
  prepared: PreparedProfileImport,
  agentAuth: ResolvedAgentAuthImport[],
): Pick<OpenClawConfig, 'agents' | 'auth' | 'models'> {
  const allModelRefs = prepared.agents.flatMap((agent) => modelRefs(agent.model));
  const providers = new Set(prepared.agents.flatMap((agent) => agent.providers));
  const providerConfig = Object.fromEntries(
    [...providers].flatMap((provider) => {
      const value = prepared.sourceConfig.models?.providers?.[provider];
      return value ? [[provider, structuredClone(value)]] : [];
    }),
  );
  const defaultModelEntries = Object.fromEntries(
    allModelRefs.flatMap((ref) => {
      const value = prepared.sourceConfig.agents?.defaults?.models?.[ref];
      return value ? [[ref, structuredClone(value)]] : [];
    }),
  );

  const availableProfileIds = new Set(
    agentAuth.flatMap(({ selection }) => Object.keys(selection.store.profiles)),
  );
  const authProfiles = Object.fromEntries(
    Object.entries(prepared.sourceConfig.auth?.profiles ?? {}).flatMap(([profileId, value]) =>
      availableProfileIds.has(profileId) ? [[profileId, structuredClone(value)]] : [],
    ),
  );
  const authOrder = Object.fromEntries(
    Object.entries(prepared.sourceConfig.auth?.order ?? {}).flatMap(([provider, profileIds]) => {
      const selected = profileIds.filter((profileId) => availableProfileIds.has(profileId));
      return selected.length > 0 ? [[provider, selected]] : [];
    }),
  );

  return {
    agents: {
      ...(Object.keys(defaultModelEntries).length > 0
        ? { defaults: { models: defaultModelEntries } }
        : {}),
      list: prepared.agents.map((agent) => ({
        id: agent.id,
        ...(agent.default ? { default: true } : {}),
        workspace: agent.workspace,
        agentDir: agent.destinationAgentDir,
        ...(agent.identity ? { identity: structuredClone(agent.identity) } : {}),
        ...(agent.model ? { model: structuredClone(agent.model) } : {}),
        ...(agent.modelEntries ? { models: structuredClone(agent.modelEntries) } : {}),
      })),
    },
    ...(Object.keys(authProfiles).length > 0 || Object.keys(authOrder).length > 0
      ? {
          auth: {
            ...(Object.keys(authProfiles).length > 0 ? { profiles: authProfiles } : {}),
            ...(Object.keys(authOrder).length > 0 ? { order: authOrder } : {}),
          },
        }
      : {}),
    ...(Object.keys(providerConfig).length > 0
      ? {
          models: {
            mode: prepared.sourceConfig.models?.mode ?? 'merge',
            providers: providerConfig,
          },
        }
      : {}),
  };
}

export function prepareProfileImport(options: PrepareProfileImportOptions): PreparedProfileImport {
  const dependencies = options.dependencies ?? {};
  const sourceStateDirectory = options.environment.OPENCLAW_STATE_DIR;
  const sourceConfigPath = options.environment.OPENCLAW_CONFIG_PATH;
  if (
    (sourceStateDirectory &&
      resolve(sourceStateDirectory) === resolve(options.destinationStateDirectory)) ||
    (sourceConfigPath &&
      resolve(dirname(sourceConfigPath)) === resolve(options.destinationStateDirectory))
  ) {
    throw new Error('DevGuard source and isolated profile state resolve to the same path');
  }
  const sourceConfig = (dependencies.loadSourceConfig ?? loadConfig)();
  const loadSourceAuthStore = dependencies.loadAuthStore ?? defaultLoadSourceAuthStore;
  const loadDestinationAuthStore = dependencies.loadAuthStore ?? defaultLoadDestinationAuthStore;
  const defaultAgentId = resolveDefaultAgentId(sourceConfig);
  const requestedAgentIds = normalizeAgentIds(options.agentIds);
  const availableAgentIds = new Set(listAgentIds(sourceConfig));
  const unknownAgentIds = requestedAgentIds.filter((agentId) => !availableAgentIds.has(agentId));
  if (unknownAgentIds.length > 0) {
    throw new Error(
      `Unknown OpenClaw agent id${unknownAgentIds.length === 1 ? '' : 's'}: ${unknownAgentIds.join(', ')}`,
    );
  }

  const selectedAgentIds = normalizeAgentIds([defaultAgentId, ...requestedAgentIds]);
  const configuredEntries = new Map(
    listAgentEntries(sourceConfig).map((entry) => [entry.id, entry]),
  );
  const agents = selectedAgentIds.map((agentId): PreparedAgentImport => {
    const configuredEntry = configuredEntries.get(agentId);
    const rawModel = options.copyModelProfile
      ? (configuredEntry?.model ?? sourceConfig.agents?.defaults?.model)
      : undefined;
    const primary = options.copyModelProfile
      ? resolveAgentEffectiveModelPrimary(sourceConfig, agentId)
      : undefined;
    const fallbacks = typeof rawModel === 'string' ? [] : (rawModel?.fallbacks ?? []);
    const model = modelConfig(primary, fallbacks);
    const refs = modelRefs(model);
    const providers = normalizeAgentIds(
      refs.map((ref) => providerFromModelRef(ref, DEFAULT_PROVIDER)),
    );
    const destinationEnvironment = {
      ...options.environment,
      OPENCLAW_STATE_DIR: options.destinationStateDirectory,
    };
    const destinationAgentDir = resolveAgentDir(
      { agents: { list: [{ id: agentId }] } },
      agentId,
      destinationEnvironment,
    );
    const sourceAgentDir = resolveAgentDir(sourceConfig, agentId, options.environment);
    if (resolve(sourceAgentDir) === resolve(destinationAgentDir)) {
      throw new Error(
        `DevGuard source and isolated agent state resolve to the same path: ${agentId}`,
      );
    }

    return {
      id: agentId,
      default: agentId === defaultAgentId,
      workspace: resolveAgentWorkspaceDir(sourceConfig, agentId, options.environment),
      sourceAgentDir,
      destinationAgentDir,
      ...(configuredEntry?.identity ? { identity: structuredClone(configuredEntry.identity) } : {}),
      ...(model ? { model } : {}),
      ...(options.copyModelProfile
        ? {
            modelEntries: selectedModelEntries(sourceConfig, configuredEntry, refs),
            providers,
            sourceAuthStore: loadSourceAuthStore(sourceAgentDir),
            destinationAuthStore: loadDestinationAuthStore(destinationAgentDir),
          }
        : { providers }),
    };
  });

  const oauthConsentProviders = normalizeAgentIds(
    agents.flatMap((agent) => {
      if (!agent.sourceAuthStore || !agent.destinationAuthStore) return [];
      const selection = selectAuthProfiles(agent.sourceAuthStore, agent.destinationAuthStore, {
        allowOAuth: false,
        providers: agent.providers,
      });
      return selection.pendingOAuthProfileIds.flatMap((profileId) => {
        const provider = agent.sourceAuthStore?.profiles[profileId]?.provider;
        if (!provider) return [];
        return hasNonOAuthAuth(agent, selection, provider, sourceConfig, options.environment)
          ? []
          : [provider];
      });
    }),
  );

  return {
    agents,
    copyModelProfile: options.copyModelProfile,
    oauthConsentProviders,
    sourceConfig,
  };
}

export function resolveProfileImport(
  prepared: PreparedProfileImport,
  allowOAuth: boolean,
): ResolvedProfileImport {
  const agentAuth = prepared.agents.flatMap((agent): ResolvedAgentAuthImport[] => {
    if (!agent.sourceAuthStore || !agent.destinationAuthStore) return [];
    return [
      {
        agentId: agent.id,
        destinationAgentDir: agent.destinationAgentDir,
        selection: selectAuthProfiles(agent.sourceAuthStore, agent.destinationAuthStore, {
          allowOAuth,
          providers: agent.providers,
        }),
      },
    ];
  });
  const auth = agentAuth.reduce(
    (summary, { selection }) => ({
      copied: summary.copied + selection.copiedProfileIds.length,
      oauth: summary.oauth + selection.copiedByType.oauth,
      preserved: summary.preserved + selection.preservedProfileIds.length,
      skipped:
        summary.skipped +
        selection.pendingOAuthProfileIds.length +
        selection.skippedOptOutProfileIds.length,
    }),
    { copied: 0, oauth: 0, preserved: 0, skipped: 0 },
  );

  return {
    agentAuth,
    agentIds: prepared.agents.map((agent) => agent.id),
    auth,
    configPatch: profileConfigPatch(prepared, agentAuth),
    modelRefs: normalizeAgentIds(prepared.agents.flatMap((agent) => modelRefs(agent.model))),
    workspaceIdentityImports: prepared.agents.flatMap((agent) =>
      agent.identity ? [] : [{ agentId: agent.id, workspace: agent.workspace }],
    ),
  };
}

export async function applyProfileIdentityImport(
  resolved: ResolvedProfileImport,
  destinationStateDirectory: string,
  environment: NodeJS.ProcessEnv,
  dependencies: ProfileImportDependencies = {},
): Promise<void> {
  const runCommand = dependencies.runCommand ?? processCommand;
  const isolatedEnvironment = isolatedOpenClawEnvironment(environment, destinationStateDirectory);
  for (const { agentId, workspace } of resolved.workspaceIdentityImports) {
    try {
      await access(join(workspace, 'IDENTITY.md'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    await runCommand(
      'openclaw',
      [
        'agents',
        'set-identity',
        '--agent',
        agentId,
        '--workspace',
        workspace,
        '--from-identity',
        '--json',
      ],
      { env: isolatedEnvironment },
    );
  }
}

export async function applyProfileAuthImport(
  resolved: ResolvedProfileImport,
  dependencies: ProfileImportDependencies = {},
): Promise<void> {
  const saveAuthStore = dependencies.saveAuthStore ?? defaultSaveAuthStore;
  const ensureAgentDir =
    dependencies.ensureAgentDir ??
    ((agentDir: string) => mkdir(agentDir, { recursive: true, mode: 0o700 }).then(() => undefined));
  for (const { destinationAgentDir, selection } of resolved.agentAuth) {
    if (selection.copiedProfileIds.length === 0) continue;
    await ensureAgentDir(destinationAgentDir);
    saveAuthStore(selection.store, destinationAgentDir);
  }
}

export { emptyStore as emptyAuthProfileStore };
