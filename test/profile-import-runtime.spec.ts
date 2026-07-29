import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  clearRuntimeAuthProfileStoreSnapshots,
  replaceRuntimeAuthProfileStoreSnapshots,
  resolveAgentDir,
  resolvePersistedAuthProfileOwnerAgentDir,
  saveAuthProfileStore,
  type AuthProfileStore,
} from 'openclaw/plugin-sdk/agent-runtime';
import type { OpenClawConfig } from 'openclaw/plugin-sdk/config-runtime';

import {
  applyProfileAuthImport,
  applyProfileIdentityImport,
  emptyAuthProfileStore,
  prepareProfileImport,
  resolveProfileImport,
} from '../lib/profile-import.ts';

const sourceConfig: OpenClawConfig = {
  agents: {
    defaults: {
      model: { primary: 'openai/model-main', fallbacks: ['other/model-fallback'] },
      workspace: '/source/workspaces',
      models: {
        'openai/model-main': { alias: 'main-model' },
        'other/model-fallback': { alias: 'fallback-model' },
      },
    },
    list: [
      { id: 'main', default: true, workspace: '/source/workspaces/main' },
      {
        id: 'ops',
        workspace: '/source/workspaces/ops',
        identity: {
          name: 'Ops',
          theme: 'debugging',
          emoji: '🤖',
          avatar: 'assets/ops.png',
        },
        model: 'openai/model-ops',
        sandbox: { mode: 'off' },
        tools: { allow: ['exec'] },
      },
    ],
  },
  auth: {
    profiles: {
      'openai:default': { provider: 'openai', mode: 'api_key' },
    },
    order: { openai: ['openai:default'] },
  },
  models: {
    mode: 'merge',
    providers: {
      openai: { baseUrl: 'https://example.invalid', models: [] },
      other: { baseUrl: 'https://fallback.invalid', models: [] },
    },
  },
};

function authStore(profiles: AuthProfileStore['profiles']): AuthProfileStore {
  return { version: 1, profiles };
}

describe('lib/profile-import', () => {
  it('should resolve the default and requested agents into isolated runtime state', () => {
    const prepared = prepareProfileImport({
      agentIds: ['ops', 'ops'],
      copyModelProfile: true,
      destinationStateDirectory: '/isolated/state',
      environment: { OPENCLAW_STATE_DIR: '/source/state' },
      dependencies: {
        loadSourceConfig: () => sourceConfig,
        loadAuthStore: (agentDir) =>
          agentDir.startsWith('/source/')
            ? authStore({
                'openai:default': {
                  type: 'api_key',
                  provider: 'openai',
                  key: 'synthetic-key',
                },
              })
            : emptyAuthProfileStore(),
      },
    });
    const resolved = resolveProfileImport(prepared, false);
    const patch = resolved.configPatch as OpenClawConfig;

    assert.deepEqual(resolved.agentIds, ['main', 'ops']);
    assert.deepEqual(resolved.workspaceIdentityImports, [
      { agentId: 'main', workspace: '/source/workspaces/main' },
    ]);
    assert.deepEqual(resolved.modelRefs, [
      'openai/model-main',
      'other/model-fallback',
      'openai/model-ops',
    ]);
    assert.deepEqual(
      patch.agents?.list?.map((agent) => ({
        id: agent.id,
        workspace: agent.workspace,
        agentDir: agent.agentDir,
      })),
      [
        {
          id: 'main',
          workspace: '/source/workspaces/main',
          agentDir: '/isolated/state/agents/main/agent',
        },
        {
          id: 'ops',
          workspace: '/source/workspaces/ops',
          agentDir: '/isolated/state/agents/ops/agent',
        },
      ],
    );
    assert.equal(patch.agents?.list?.[0]?.tools, undefined);
    assert.equal(patch.agents?.list?.[0]?.sandbox, undefined);
    assert.equal(patch.agents?.list?.[1]?.tools, undefined);
    assert.equal(patch.agents?.list?.[1]?.sandbox, undefined);
    assert.deepEqual(patch.agents?.list?.[1]?.identity, {
      name: 'Ops',
      theme: 'debugging',
      emoji: '🤖',
      avatar: 'assets/ops.png',
    });
    assert.notEqual(patch.agents?.list?.[1]?.identity, sourceConfig.agents?.list?.[1]?.identity);
    assert.deepEqual(Object.keys(patch.models?.providers ?? {}).sort(), ['openai', 'other']);
    assert.equal(resolved.auth.copied, 2);
  });

  it('should load a workspace-only identity through isolated openclaw state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-profile-identity-'));
    const workspace = join(root, 'devbot');
    const destinationStateDirectory = join(root, 'isolated');
    const environment = {
      OPENCLAW_CONFIG_PATH: join(root, 'source', 'openclaw.json'),
      OPENCLAW_STATE_DIR: join(root, 'source'),
    };
    const commands: Array<{
      args: readonly string[];
      command: string;
      environment: NodeJS.ProcessEnv | undefined;
    }> = [];

    try {
      await mkdir(workspace, { recursive: true });
      await writeFile(join(workspace, 'IDENTITY.md'), '- Name: Devbot\n', 'utf8');
      const prepared = prepareProfileImport({
        agentIds: ['devbot'],
        copyModelProfile: false,
        destinationStateDirectory,
        environment,
        dependencies: {
          loadSourceConfig: () => ({
            agents: {
              list: [
                {
                  id: 'main',
                  default: true,
                  identity: { name: 'Main' },
                  workspace: join(root, 'main'),
                },
                { id: 'devbot', workspace },
              ],
            },
          }),
        },
      });
      const resolved = resolveProfileImport(prepared, false);

      assert.deepEqual(resolved.workspaceIdentityImports, [{ agentId: 'devbot', workspace }]);
      await applyProfileIdentityImport(resolved, destinationStateDirectory, environment, {
        runCommand: async (command, args, options) => {
          commands.push({ args, command, environment: options?.env });
          return { code: 0, output: '{}' };
        },
      });

      assert.deepEqual(commands, [
        {
          command: 'openclaw',
          args: [
            'agents',
            'set-identity',
            '--agent',
            'devbot',
            '--workspace',
            workspace,
            '--from-identity',
            '--json',
          ],
          environment: {
            OPENCLAW_STATE_DIR: destinationStateDirectory,
          },
        },
      ]);
      assert.deepEqual(environment, {
        OPENCLAW_CONFIG_PATH: join(root, 'source', 'openclaw.json'),
        OPENCLAW_STATE_DIR: join(root, 'source'),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('should reject unknown requested agents before resolving auth stores', () => {
    let authLoads = 0;
    assert.throws(
      () =>
        prepareProfileImport({
          agentIds: ['missing'],
          copyModelProfile: true,
          destinationStateDirectory: '/isolated/state',
          environment: { OPENCLAW_STATE_DIR: '/source/state' },
          dependencies: {
            loadSourceConfig: () => sourceConfig,
            loadAuthStore: () => {
              authLoads += 1;
              return emptyAuthProfileStore();
            },
          },
        }),
      /Unknown OpenClaw agent id: missing/,
    );
    assert.equal(authLoads, 0);
  });

  it('should reject a destination that resolves to the source agent state', () => {
    assert.throws(
      () =>
        prepareProfileImport({
          copyModelProfile: false,
          destinationStateDirectory: '/isolated/state',
          environment: { OPENCLAW_STATE_DIR: '/source/state' },
          dependencies: {
            loadSourceConfig: () => ({
              ...sourceConfig,
              agents: {
                ...sourceConfig.agents,
                list: [
                  {
                    id: 'main',
                    default: true,
                    agentDir: '/isolated/state/agents/main/agent',
                  },
                ],
              },
            }),
          },
        }),
      /source and isolated agent state resolve to the same path: main/,
    );
  });

  it('should reject the source state before accepting an external source agent directory', () => {
    assert.throws(
      () =>
        prepareProfileImport({
          copyModelProfile: false,
          destinationStateDirectory: '/isolated/state',
          environment: { OPENCLAW_STATE_DIR: '/isolated/state' },
          dependencies: {
            loadSourceConfig: () => ({
              agents: {
                list: [{ id: 'main', default: true, agentDir: '/external/main/agent' }],
              },
            }),
          },
        }),
      /source and isolated profile state resolve to the same path/,
    );
  });

  it('should import agent workspaces without model or auth state when disabled', () => {
    const prepared = prepareProfileImport({
      agentIds: ['ops'],
      copyModelProfile: false,
      destinationStateDirectory: '/isolated/state',
      environment: { OPENCLAW_STATE_DIR: '/source/state' },
      dependencies: { loadSourceConfig: () => sourceConfig },
    });
    const resolved = resolveProfileImport(prepared, false);
    const patch = resolved.configPatch as OpenClawConfig;

    assert.deepEqual(resolved.modelRefs, []);
    assert.equal(resolved.agentAuth.length, 0);
    assert.equal(patch.models, undefined);
    assert.equal(patch.auth, undefined);
    assert.equal(patch.agents?.list?.[0]?.model, undefined);
  });

  it('should request oauth consent only when no non-oauth route is available', () => {
    const oauthConfig: OpenClawConfig = {
      ...sourceConfig,
      agents: { list: [{ id: 'main', default: true, model: 'openai/model-main' }] },
      models: undefined,
    };
    const prepared = prepareProfileImport({
      copyModelProfile: true,
      destinationStateDirectory: '/isolated/state',
      environment: { OPENCLAW_STATE_DIR: '/source/state' },
      dependencies: {
        loadSourceConfig: () => oauthConfig,
        loadAuthStore: (agentDir) =>
          agentDir.startsWith('/source/')
            ? authStore({
                'openai:oauth': {
                  type: 'oauth',
                  provider: 'openai',
                  access: 'access-token',
                  refresh: 'refresh-token',
                  expires: Date.now() + 60_000,
                },
              })
            : emptyAuthProfileStore(),
      },
    });

    assert.deepEqual(prepared.oauthConsentProviders, ['openai']);
    assert.equal(resolveProfileImport(prepared, true).auth.oauth, 1);
  });

  it('should save only auth stores that gained copied credentials', async () => {
    const writes: Array<{ agentDir: string; profiles: string[] }> = [];
    const prepared = prepareProfileImport({
      copyModelProfile: true,
      destinationStateDirectory: '/isolated/state',
      environment: { OPENCLAW_STATE_DIR: '/source/state' },
      dependencies: {
        loadSourceConfig: () => sourceConfig,
        loadAuthStore: (agentDir) =>
          agentDir.startsWith('/source/')
            ? authStore({
                'openai:default': {
                  type: 'api_key',
                  provider: 'openai',
                  key: 'synthetic-key',
                },
              })
            : emptyAuthProfileStore(),
      },
    });

    await applyProfileAuthImport(resolveProfileImport(prepared, false), {
      ensureAgentDir: async () => undefined,
      saveAuthStore: (store, agentDir) => {
        writes.push({ agentDir, profiles: Object.keys(store.profiles) });
      },
    });

    assert.deepEqual(writes, [
      {
        agentDir: '/isolated/state/agents/main/agent',
        profiles: ['openai:default'],
      },
    ]);
  });

  it('should copy persisted source auth instead of an empty runtime snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-profile-import-'));
    const sourceStateDirectory = join(root, 'source');
    const destinationStateDirectory = join(root, 'destination');
    const previousStateDirectory = process.env.OPENCLAW_STATE_DIR;
    const previousConfigPath = process.env.OPENCLAW_CONFIG_PATH;
    const profileId = 'openai:persisted';

    try {
      process.env.OPENCLAW_STATE_DIR = sourceStateDirectory;
      delete process.env.OPENCLAW_CONFIG_PATH;
      const sourceAgentDir = resolveAgentDir(sourceConfig, 'main', process.env);
      await mkdir(sourceAgentDir, { recursive: true });
      saveAuthProfileStore(
        authStore({
          [profileId]: {
            type: 'api_key',
            provider: 'openai',
            key: 'persisted-key',
          },
        }),
        sourceAgentDir,
        { filterExternalAuthProfiles: true, syncExternalCli: false },
      );
      replaceRuntimeAuthProfileStoreSnapshots([
        { agentDir: sourceAgentDir, store: emptyAuthProfileStore() },
      ]);

      const prepared = prepareProfileImport({
        copyModelProfile: true,
        destinationStateDirectory,
        environment: { ...process.env },
        dependencies: { loadSourceConfig: () => sourceConfig },
      });
      const resolved = resolveProfileImport(prepared, false);
      assert.equal(resolved.auth.copied, 1);
      assert.equal(resolved.auth.preserved, 0);

      await applyProfileAuthImport(resolved);
      const destinationAgentDir = resolveAgentDir({ agents: { list: [{ id: 'main' }] } }, 'main', {
        ...process.env,
        OPENCLAW_STATE_DIR: destinationStateDirectory,
      });
      assert.equal(
        resolvePersistedAuthProfileOwnerAgentDir({
          agentDir: destinationAgentDir,
          profileId,
        }),
        destinationAgentDir,
      );
    } finally {
      clearRuntimeAuthProfileStoreSnapshots();
      if (previousStateDirectory === undefined) delete process.env.OPENCLAW_STATE_DIR;
      else process.env.OPENCLAW_STATE_DIR = previousStateDirectory;
      if (previousConfigPath === undefined) delete process.env.OPENCLAW_CONFIG_PATH;
      else process.env.OPENCLAW_CONFIG_PATH = previousConfigPath;
      await rm(root, { recursive: true, force: true });
    }
  });
});
