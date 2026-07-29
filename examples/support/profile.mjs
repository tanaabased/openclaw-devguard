import { access, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { clearConfigCache, loadConfig, writeConfigFile } from 'openclaw/plugin-sdk/config-runtime';
import {
  ensureAuthProfileStoreWithoutExternalProfiles,
  resolveAgentDir,
  resolveAgentEffectiveModelPrimary,
  resolveAgentWorkspaceDir,
  saveAuthProfileStore,
} from 'openclaw/plugin-sdk/agent-runtime';

const MODEL_REF = process.env.DEVGUARD_LIVE_MODEL || 'openai/gpt-5.6-sol';
const PROFILE_ID = 'openai:devguard-leia';
const PROFILE_KEY = process.env.OPENAI_API_KEY || 'leia-model-key';

function requireArgument(value, label) {
  if (!value) throw new Error(`${label} is required`);
  return value;
}

function useStateDirectory(stateDirectory) {
  process.env.OPENCLAW_STATE_DIR = stateDirectory;
  delete process.env.OPENCLAW_CONFIG_PATH;
  clearConfigCache();
}

async function seedModel() {
  const stateDirectory = requireArgument(process.env.OPENCLAW_STATE_DIR, 'OPENCLAW_STATE_DIR');
  const temporaryDirectory = requireArgument(process.env.TMPDIR, 'TMPDIR');
  const workspace = join(temporaryDirectory, 'source-main');
  const config = {
    agents: { defaults: { model: MODEL_REF, workspace } },
    auth: {
      profiles: { [PROFILE_ID]: { provider: 'openai', mode: 'api_key' } },
      order: { openai: [PROFILE_ID] },
    },
  };

  await mkdir(workspace, { recursive: true });
  useStateDirectory(stateDirectory);
  await writeConfigFile(config);
  const agentDir = resolveAgentDir(config, 'main', process.env);
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  saveAuthProfileStore(
    {
      version: 1,
      profiles: {
        [PROFILE_ID]: { type: 'api_key', provider: 'openai', key: PROFILE_KEY },
      },
      order: { openai: [PROFILE_ID] },
    },
    agentDir,
    { filterExternalAuthProfiles: true, syncExternalCli: false },
  );
}

async function seedAgent() {
  const stateDirectory = requireArgument(process.env.OPENCLAW_STATE_DIR, 'OPENCLAW_STATE_DIR');
  const temporaryDirectory = requireArgument(process.env.TMPDIR, 'TMPDIR');
  const config = {
    agents: {
      list: [
        { id: 'main', default: true, workspace: join(temporaryDirectory, 'source-main') },
        { id: 'ops', workspace: join(temporaryDirectory, 'source-ops') },
      ],
    },
  };

  await Promise.all(
    config.agents.list.map(({ workspace }) => mkdir(workspace, { recursive: true })),
  );
  useStateDirectory(stateDirectory);
  await writeConfigFile(config);
}

function loadStateConfig(stateDirectory) {
  useStateDirectory(stateDirectory);
  return loadConfig();
}

function loadAgentAuth(config, agentId) {
  const agentDir = resolveAgentDir(config, agentId, process.env);
  return ensureAuthProfileStoreWithoutExternalProfiles(agentDir, {
    allowKeychainPrompt: false,
    readOnly: true,
    syncExternalCli: false,
  });
}

async function assertModel(destinationStateDirectory, sourceStateDirectory) {
  const destinationConfig = loadStateConfig(destinationStateDirectory);
  if (resolveAgentEffectiveModelPrimary(destinationConfig, 'main') !== MODEL_REF) {
    throw new Error('isolated profile did not import the source model');
  }
  const destinationAgentDir = resolveAgentDir(destinationConfig, 'main', process.env);
  if (!destinationAgentDir.startsWith(join(destinationStateDirectory, 'agents'))) {
    throw new Error('isolated model agent reused source agent state');
  }
  const destinationCredential = loadAgentAuth(destinationConfig, 'main').profiles[PROFILE_ID];
  if (destinationCredential?.type !== 'api_key' || destinationCredential.key !== PROFILE_KEY) {
    throw new Error('isolated profile did not import the source api key');
  }

  const sourceConfig = loadStateConfig(sourceStateDirectory);
  const sourceCredential = loadAgentAuth(sourceConfig, 'main').profiles[PROFILE_ID];
  if (sourceCredential?.type !== 'api_key' || sourceCredential.key !== PROFILE_KEY) {
    throw new Error('source api key changed during import');
  }
}

async function directoryIsEmpty(path) {
  try {
    return (await readdir(path)).length === 0;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
}

async function assertAgent(destinationStateDirectory, sourceStateDirectory) {
  const destinationConfig = loadStateConfig(destinationStateDirectory);
  const sourceConfig = loadStateConfig(sourceStateDirectory);
  const agents = destinationConfig.agents?.list ?? [];
  if (agents.map(({ id }) => id).join(',') !== 'main,ops') {
    throw new Error('isolated profile did not import the selected agents');
  }
  for (const agentId of ['main', 'ops']) {
    const destinationWorkspace = resolveAgentWorkspaceDir(destinationConfig, agentId, process.env);
    useStateDirectory(sourceStateDirectory);
    const sourceWorkspace = resolveAgentWorkspaceDir(sourceConfig, agentId, process.env);
    if (destinationWorkspace !== sourceWorkspace) {
      throw new Error(`${agentId} did not retain its source workspace`);
    }
    useStateDirectory(destinationStateDirectory);
    const destinationAgentDir = resolveAgentDir(destinationConfig, agentId, process.env);
    if (!destinationAgentDir.startsWith(join(destinationStateDirectory, 'agents'))) {
      throw new Error(`${agentId} reused source agent state`);
    }
    if (!(await directoryIsEmpty(join(destinationStateDirectory, 'agents', agentId, 'sessions')))) {
      throw new Error(`${agentId} imported source sessions`);
    }
  }
  if (destinationConfig.channels !== undefined || destinationConfig.bindings !== undefined) {
    throw new Error('isolated agent import included messaging configuration');
  }
  await access(resolveAgentWorkspaceDir(destinationConfig, 'ops', process.env));
}

const [action, ...args] = process.argv.slice(2);

switch (action) {
  case 'seed-model':
    await seedModel();
    break;
  case 'seed-agent':
    await seedAgent();
    break;
  case 'assert-model':
    await assertModel(
      requireArgument(args[0], 'destination state'),
      requireArgument(args[1], 'source state'),
    );
    break;
  case 'assert-agent':
    await assertAgent(
      requireArgument(args[0], 'destination state'),
      requireArgument(args[1], 'source state'),
    );
    break;
  default:
    throw new Error(`unknown profile example action: ${String(action)}`);
}
