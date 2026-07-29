import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { clearConfigCache, loadConfig } from 'openclaw/plugin-sdk/config-runtime';
import {
  loadAuthProfileStoreWithoutExternalProfiles,
  resolveAgentDir,
  resolveAgentEffectiveModelPrimary,
  resolveAgentWorkspaceDir,
} from 'openclaw/plugin-sdk/agent-runtime';

const MODEL_REF = `openai/${process.env.OPENAI_MODEL || 'gpt-5.4-nano'}`;
const PROFILE_ID = 'openai:api-key';
const PROFILE_KEY = process.env.OPENAI_API_KEY || 'leia-model-key';
const ADDITIONAL_AGENT_ID = 'devbot';
const IDENTITY_FIELDS = ['name', 'theme', 'emoji', 'avatar'];

function requireArgument(value, label) {
  if (!value) throw new Error(`${label} is required`);
  return value;
}

function useStateDirectory(stateDirectory) {
  process.env.OPENCLAW_STATE_DIR = stateDirectory;
  delete process.env.OPENCLAW_CONFIG_PATH;
  clearConfigCache();
}

function loadStateConfig(stateDirectory) {
  useStateDirectory(stateDirectory);
  return loadConfig();
}

function loadAgentAuth(config, agentId) {
  const agentDir = resolveAgentDir(config, agentId, process.env);
  return loadAuthProfileStoreWithoutExternalProfiles(agentDir, {
    allowKeychainPrompt: false,
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
  if (agents.map(({ id }) => id).join(',') !== `main,${ADDITIONAL_AGENT_ID}`) {
    throw new Error('isolated profile did not import the selected agents');
  }
  for (const agentId of ['main', ADDITIONAL_AGENT_ID]) {
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
  const destinationAgent = agents.find(({ id }) => id === ADDITIONAL_AGENT_ID);
  const sourceAgent = sourceConfig.agents?.list?.find(({ id }) => id === ADDITIONAL_AGENT_ID);
  if (
    sourceAgent?.identity?.name !== 'Devbot' ||
    sourceAgent.identity.avatar !== 'assets/devbot.png'
  ) {
    throw new Error('source devbot identity was not loaded from its workspace');
  }
  if (!destinationAgent?.identity) {
    throw new Error('isolated devbot identity was not imported');
  }
  for (const field of IDENTITY_FIELDS) {
    if (destinationAgent?.identity?.[field] !== sourceAgent?.identity?.[field]) {
      throw new Error(`isolated ${ADDITIONAL_AGENT_ID} identity did not retain ${field}`);
    }
  }
  const workspace = resolveAgentWorkspaceDir(destinationConfig, ADDITIONAL_AGENT_ID, process.env);
  await access(join(workspace, 'IDENTITY.md'));
  await access(join(workspace, 'assets', 'devbot.png'));
}

const [action, ...args] = process.argv.slice(2);

switch (action) {
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
