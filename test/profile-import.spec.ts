import assert from 'node:assert/strict';

import type { AuthProfileStore } from 'openclaw/plugin-sdk/agent-runtime';

import {
  normalizeAgentIds,
  providerFromModelRef,
  selectAuthProfiles,
} from '../utils/profile-import.ts';

function store(profiles: AuthProfileStore['profiles']): AuthProfileStore {
  return { version: 1, profiles };
}

describe('utils/profile-import', () => {
  it('should normalize repeated agent ids in their original order', () => {
    assert.deepEqual(normalizeAgentIds([' ops ', 'main', 'ops', '']), ['ops', 'main']);
  });

  it('should resolve providers from qualified and bare model references', () => {
    assert.equal(providerFromModelRef('openai/gpt-test', 'anthropic'), 'openai');
    assert.equal(providerFromModelRef('model-test', 'anthropic'), 'anthropic');
  });

  it('should copy portable credentials for selected providers without copying source state', () => {
    const source: AuthProfileStore = {
      ...store({
        'openai:key': { type: 'api_key', provider: 'openai', key: 'test-key' },
        'openai:token': { type: 'token', provider: 'openai', token: 'test-token' },
        'other:key': { type: 'api_key', provider: 'other', key: 'other-key' },
      }),
      order: { openai: ['openai:token', 'openai:key'] },
      lastGood: { openai: 'openai:token' },
      usageStats: { 'openai:token': { errorCount: 4 } },
    };

    const result = selectAuthProfiles(source, store({}), {
      allowOAuth: false,
      providers: ['openai'],
    });

    assert.deepEqual(Object.keys(result.store.profiles).sort(), ['openai:key', 'openai:token']);
    assert.deepEqual(result.store.order, { openai: ['openai:token', 'openai:key'] });
    assert.equal(result.store.lastGood, undefined);
    assert.equal(result.store.usageStats, undefined);
    assert.deepEqual(result.copiedByType, { apiKey: 1, oauth: 0, token: 1 });
  });

  it('should preserve isolated credentials and honor static credential copy opt-outs', () => {
    const destination = store({
      'openai:key': { type: 'api_key', provider: 'openai', key: 'isolated-key' },
    });
    const result = selectAuthProfiles(
      store({
        'openai:key': { type: 'api_key', provider: 'openai', key: 'source-key' },
        'openai:private': {
          type: 'api_key',
          provider: 'openai',
          key: 'private-key',
          copyToAgents: false,
        },
      }),
      destination,
      { allowOAuth: false, providers: ['openai'] },
    );

    assert.equal(result.store.profiles['openai:key']?.type, 'api_key');
    assert.equal(
      (result.store.profiles['openai:key'] as { key?: string } | undefined)?.key,
      'isolated-key',
    );
    assert.deepEqual(result.preservedProfileIds, ['openai:key']);
    assert.deepEqual(result.skippedOptOutProfileIds, ['openai:private']);
  });

  it('should require explicit permission for non-portable oauth credentials', () => {
    const source = store({
      'openai:oauth': {
        type: 'oauth',
        provider: 'openai',
        access: 'access-token',
        refresh: 'refresh-token',
        expires: Date.now() + 60_000,
      },
      'openai:portable': {
        type: 'oauth',
        provider: 'openai',
        access: 'portable-access-token',
        refresh: 'portable-refresh-token',
        expires: Date.now() + 60_000,
        copyToAgents: true,
      },
    });

    const defaultResult = selectAuthProfiles(source, store({}), {
      allowOAuth: false,
      providers: ['openai'],
    });
    assert.deepEqual(defaultResult.pendingOAuthProfileIds, ['openai:oauth']);
    assert.deepEqual(defaultResult.copiedProfileIds, ['openai:portable']);

    const allowedResult = selectAuthProfiles(source, store({}), {
      allowOAuth: true,
      providers: ['openai'],
    });
    assert.deepEqual(allowedResult.pendingOAuthProfileIds, []);
    assert.deepEqual(allowedResult.copiedByType, { apiKey: 0, oauth: 2, token: 0 });
  });
});
