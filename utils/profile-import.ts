import type { AuthProfileCredential, AuthProfileStore } from 'openclaw/plugin-sdk/agent-runtime';

export interface AuthImportSelection {
  copiedByType: {
    apiKey: number;
    oauth: number;
    token: number;
  };
  copiedProfileIds: string[];
  pendingOAuthProfileIds: string[];
  preservedProfileIds: string[];
  skippedOptOutProfileIds: string[];
  store: AuthProfileStore;
}

export interface SelectAuthProfilesOptions {
  allowOAuth: boolean;
  providers: readonly string[];
}

function copyCredential(credential: AuthProfileCredential): AuthProfileCredential {
  return structuredClone(credential);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function normalizeAgentIds(values: readonly string[] | undefined): string[] {
  return unique((values ?? []).map((value) => value.trim()));
}

export function providerFromModelRef(modelRef: string, defaultProvider: string): string {
  const separator = modelRef.indexOf('/');
  return separator > 0 ? modelRef.slice(0, separator) : defaultProvider;
}

export function selectAuthProfiles(
  source: AuthProfileStore,
  destination: AuthProfileStore,
  options: SelectAuthProfilesOptions,
): AuthImportSelection {
  const providers = new Set(options.providers);
  const profiles = { ...destination.profiles };
  const copiedProfileIds: string[] = [];
  const pendingOAuthProfileIds: string[] = [];
  const preservedProfileIds: string[] = [];
  const skippedOptOutProfileIds: string[] = [];
  const copiedByType = { apiKey: 0, oauth: 0, token: 0 };

  for (const [profileId, credential] of Object.entries(source.profiles)) {
    if (!providers.has(credential.provider)) continue;
    if (profiles[profileId]) {
      preservedProfileIds.push(profileId);
      continue;
    }
    if (credential.type !== 'oauth' && credential.copyToAgents === false) {
      skippedOptOutProfileIds.push(profileId);
      continue;
    }
    if (credential.type === 'oauth' && credential.copyToAgents !== true && !options.allowOAuth) {
      pendingOAuthProfileIds.push(profileId);
      continue;
    }

    profiles[profileId] = copyCredential(credential);
    copiedProfileIds.push(profileId);
    if (credential.type === 'api_key') copiedByType.apiKey += 1;
    if (credential.type === 'oauth') copiedByType.oauth += 1;
    if (credential.type === 'token') copiedByType.token += 1;
  }

  const order = structuredClone(destination.order ?? {});
  for (const provider of providers) {
    const sourceOrder = source.order?.[provider] ?? [];
    const destinationOrder = order[provider] ?? [];
    const available = new Set(Object.keys(profiles));
    const merged = unique([...destinationOrder, ...sourceOrder]).filter((id) => available.has(id));
    if (merged.length > 0) order[provider] = merged;
  }

  return {
    copiedByType,
    copiedProfileIds,
    pendingOAuthProfileIds,
    preservedProfileIds,
    skippedOptOutProfileIds,
    store: {
      version: Math.max(source.version, destination.version),
      profiles,
      ...(Object.keys(order).length > 0 ? { order } : {}),
      ...(destination.lastGood ? { lastGood: structuredClone(destination.lastGood) } : {}),
      ...(destination.usageStats ? { usageStats: structuredClone(destination.usageStats) } : {}),
    },
  };
}
