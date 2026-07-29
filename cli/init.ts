import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { copyFile, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import {
  ensureProjectConfig,
  resolveProjectPaths,
  type DevguardProjectConfig,
} from '../lib/project-config.ts';
import processCommand from '../lib/process-command.ts';
import {
  defaultCliOutput,
  formatCliAction,
  formatCliField,
  formatCliTarget,
  type CliOutput,
  writeCliLines,
} from '../lib/cli-output.ts';
import { logDebug, logInfo, type Logger } from '../lib/logger.ts';
import {
  applyProfileAuthImport,
  prepareProfileImport,
  resolveProfileImport,
  type ProfileImportDependencies,
  type ResolvedProfileImport,
} from '../lib/profile-import.ts';

export interface InitDevguardOptions {
  agentIds?: string[];
  confirmOAuthCopy?: (providers: string[]) => Promise<boolean>;
  copyModelProfile?: boolean;
  copyOAuth?: boolean;
  environment?: NodeJS.ProcessEnv;
  logger: Logger;
  output?: CliOutput;
  profileImportDependencies?: ProfileImportDependencies;
  pluginRoot?: string;
}

export interface InitDevguardResult {
  config: DevguardProjectConfig;
  configCreated: boolean;
  pluginRoot: string;
  stateDirectory: string;
  logPath: string;
  profileImport: ResolvedProfileImport;
  snapshotPath?: string;
}

interface InitializationProfileImportMarker {
  agentIds?: unknown;
}

interface InitializationMarker {
  profileImport?: InitializationProfileImportMarker;
  snapshotPath?: string | null;
  [key: string]: unknown;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError('DevGuard initialization marker must be an object');
  }
  return value as Record<string, unknown>;
}

function importedAgentIds(marker: InitializationMarker | undefined): string[] {
  const values = marker?.profileImport?.agentIds;
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
    throw new TypeError('DevGuard initialization marker profileImport.agentIds must be strings');
  }
  return values;
}

async function readInitializationMarker(
  projectStateRoot: string,
): Promise<InitializationMarker | undefined> {
  try {
    return record(JSON.parse(await readFile(join(projectStateRoot, 'init.json'), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function assertRestorableDestination(
  stateDirectory: string,
  marker: InitializationMarker | undefined,
): Promise<void> {
  if (marker) return;
  let entries: string[];
  try {
    entries = await readdir(stateDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const unmanaged = entries.filter((entry) => entry !== 'openclaw.json');
  if (unmanaged.length > 0) {
    throw new Error(
      `DevGuard isolated destination contains unmanaged state: ${unmanaged.join(', ')}`,
    );
  }
}

async function confirmOAuthCopy(providers: string[]): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new Error(
      `OAuth credentials for ${providers.join(', ')} require explicit consent; re-run with --copy-oauth`,
    );
  }
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await prompt.question(
      `copy refreshable OAuth credentials for ${providers.join(', ')} into isolated state? [y/N] `,
    );
    return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
  } finally {
    prompt.close();
  }
}

export function createIsolatedStatePatch(
  port: number,
  gatewayToken: string,
  profilePatch: Record<string, unknown>,
): Record<string, unknown> {
  const profileAgents =
    profilePatch.agents &&
    typeof profilePatch.agents === 'object' &&
    !Array.isArray(profilePatch.agents)
      ? (profilePatch.agents as Record<string, unknown>)
      : {};
  const profileDefaults =
    profileAgents.defaults &&
    typeof profileAgents.defaults === 'object' &&
    !Array.isArray(profileAgents.defaults)
      ? (profileAgents.defaults as Record<string, unknown>)
      : {};
  return {
    ...profilePatch,
    gateway: {
      mode: 'local',
      bind: 'loopback',
      auth: { mode: 'token', token: gatewayToken },
      port,
    },
    tools: { exec: { mode: 'deny' }, elevated: { enabled: false } },
    agents: {
      ...profileAgents,
      defaults: {
        ...profileDefaults,
        sandbox: { mode: 'all', workspaceAccess: 'none' },
      },
    },
  };
}

async function configureIsolatedState(
  stateDirectory: string,
  port: number,
  environment: NodeJS.ProcessEnv,
  profilePatch: Record<string, unknown>,
): Promise<void> {
  const isolatedEnvironment = { ...environment, OPENCLAW_STATE_DIR: stateDirectory };
  const tokenPath = join(dirname(stateDirectory), 'gateway-token');
  let gatewayToken: string;
  try {
    gatewayToken = (await readFile(tokenPath, 'utf8')).trim();
    if (gatewayToken.length === 0) throw new Error(`DevGuard token file is empty: ${tokenPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    gatewayToken = randomBytes(32).toString('hex');
    await mkdir(dirname(tokenPath), { recursive: true });
    await writeFile(tokenPath, `${gatewayToken}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  }
  const patch = createIsolatedStatePatch(port, gatewayToken, profilePatch);
  await processCommand('openclaw', ['config', 'patch', '--stdin'], {
    env: isolatedEnvironment,
    input: JSON.stringify(patch),
  });
}

async function snapshotConfiguration(
  projectStateRoot: string,
  stateDirectory: string,
): Promise<string | undefined> {
  const markerPath = join(projectStateRoot, 'init.json');
  try {
    const marker = (await readInitializationMarker(projectStateRoot)) ?? {};
    return typeof marker.snapshotPath === 'string' ? marker.snapshotPath : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  await mkdir(projectStateRoot, { recursive: true });
  const configPath = join(stateDirectory, 'openclaw.json');
  const snapshotPath = join(projectStateRoot, 'openclaw.before-devguard.json');
  let snapshot: string | undefined;
  try {
    await mkdir(dirname(snapshotPath), { recursive: true });
    await copyFile(configPath, snapshotPath);
    snapshot = snapshotPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await writeFile(
    markerPath,
    `${JSON.stringify({ version: 1, configPath, snapshotPath: snapshot ?? null }, null, 2)}\n`,
    'utf8',
  );
  return snapshot;
}

async function writeProfileImportMarker(
  projectStateRoot: string,
  profileImport: ResolvedProfileImport,
  copyModelProfile: boolean,
): Promise<void> {
  const markerPath = join(projectStateRoot, 'init.json');
  const marker = (await readInitializationMarker(projectStateRoot)) ?? {};
  const next = {
    ...marker,
    profileImport: {
      version: 1,
      agentIds: profileImport.agentIds,
      modelProfile: copyModelProfile,
      modelCount: profileImport.modelRefs.length,
      copiedAuthCount: profileImport.auth.copied,
    },
  };
  const temporaryPath = `${markerPath}.next`;
  await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, markerPath);
}

async function ensureLinkedPlugin(
  pluginId: string,
  pluginRoot: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const inspection = await processCommand('openclaw', ['plugins', 'inspect', pluginId, '--json'], {
    env: environment,
    allowFailure: true,
  });
  if (inspection.code === 0 && inspection.output.includes(pluginRoot)) return;
  if (inspection.code === 0) {
    await processCommand('openclaw', ['plugins', 'uninstall', pluginId, '--force'], {
      env: environment,
    });
  }
  await processCommand('openclaw', ['plugins', 'install', pluginRoot, '--link'], {
    env: environment,
  });
}

export default async function initDevguard(
  pluginPath = '.',
  options: InitDevguardOptions,
): Promise<InitDevguardResult> {
  if (!options.pluginRoot) {
    throw new Error('DevGuard could not resolve its installed plugin root');
  }

  const environment = options.environment ?? process.env;
  logDebug(options.logger, `initializing plugin workspace ${resolve(pluginPath)}`);
  const pluginRoot = await realpath(resolve(pluginPath));
  const devguardRoot = await realpath(options.pluginRoot);
  const { config, created } = await ensureProjectConfig(pluginRoot);
  const paths = resolveProjectPaths(pluginRoot, config.plugin.id, environment);
  const existingMarker = await readInitializationMarker(paths.projectStateRoot);
  await assertRestorableDestination(paths.stateDirectory, existingMarker);
  const copyModelProfile = options.copyModelProfile !== false;
  const preparedProfileImport = prepareProfileImport({
    agentIds: [...importedAgentIds(existingMarker), ...(options.agentIds ?? [])],
    copyModelProfile,
    dependencies: options.profileImportDependencies,
    destinationStateDirectory: paths.stateDirectory,
    environment,
  });
  let copyOAuth = options.copyOAuth === true;
  if (!copyOAuth && preparedProfileImport.oauthConsentProviders.length > 0) {
    const confirm = options.confirmOAuthCopy ?? confirmOAuthCopy;
    copyOAuth = await confirm(preparedProfileImport.oauthConsentProviders);
    if (!copyOAuth) {
      throw new Error('OAuth credential copy was declined; initialization did not continue');
    }
  }
  const profileImport = resolveProfileImport(preparedProfileImport, copyOAuth);
  const snapshotPath = await snapshotConfiguration(paths.projectStateRoot, paths.stateDirectory);
  await configureIsolatedState(
    paths.stateDirectory,
    config.gateway.port,
    environment,
    profileImport.configPatch,
  );
  await applyProfileAuthImport(profileImport, options.profileImportDependencies);
  await writeProfileImportMarker(paths.projectStateRoot, profileImport, copyModelProfile);

  logDebug(options.logger, `building plugin ${config.plugin.id}`);
  await processCommand(config.plugin.build.command, config.plugin.build.args, {
    cwd: pluginRoot,
    env: environment,
    inherit: true,
  });
  if (config.plugin.validate) {
    logDebug(options.logger, `validating plugin ${config.plugin.id}`);
    await processCommand(config.plugin.validate.command, config.plugin.validate.args, {
      cwd: pluginRoot,
      env: environment,
      inherit: true,
    });
  }

  const isolatedEnvironment = {
    ...environment,
    OPENCLAW_STATE_DIR: paths.stateDirectory,
    OPENCLAW_SKIP_CHANNELS: '1',
  };
  if (config.plugin.id === 'openclaw-devguard') {
    await ensureLinkedPlugin(config.plugin.id, pluginRoot, isolatedEnvironment);
  } else {
    await processCommand('openclaw', ['plugins', 'install', devguardRoot, '--force'], {
      env: isolatedEnvironment,
    });
  }
  await processCommand('openclaw', ['plugins', 'enable', 'openclaw-devguard'], {
    env: isolatedEnvironment,
  });
  if (config.plugin.id !== 'openclaw-devguard') {
    await ensureLinkedPlugin(config.plugin.id, pluginRoot, isolatedEnvironment);
  }
  await processCommand('openclaw', ['plugins', 'enable', config.plugin.id], {
    env: isolatedEnvironment,
  });
  await processCommand(
    'openclaw',
    ['plugins', 'inspect', config.plugin.id, '--runtime', '--json'],
    { env: isolatedEnvironment },
  );
  await processCommand('openclaw', ['plugins', 'doctor'], { env: isolatedEnvironment });
  logInfo(options.logger, `initialized plugin ${config.plugin.id}`);

  const result = {
    config,
    configCreated: created,
    pluginRoot,
    stateDirectory: paths.stateDirectory,
    logPath: paths.logPath,
    profileImport,
    snapshotPath,
  };
  const output = options.output ?? defaultCliOutput;
  writeCliLines(output, [
    formatCliAction('initialized', result.config.plugin.id),
    formatCliTarget('project', result.pluginRoot),
    formatCliTarget('state', result.stateDirectory),
    formatCliTarget('log', result.logPath),
    formatCliField('agents', result.profileImport.agentIds.join(', ')),
    formatCliField(
      'model',
      copyModelProfile
        ? result.profileImport.modelRefs.join(', ') || 'not configured'
        : 'not imported',
    ),
    formatCliField(
      'auth',
      copyModelProfile
        ? `${result.profileImport.auth.copied} copied, ${result.profileImport.auth.preserved} preserved, ${result.profileImport.auth.skipped} skipped`
        : 'not imported',
    ),
    formatCliField('config', result.configCreated ? 'created' : 'reused'),
    formatCliTarget('next', 'openclaw devguard run'),
  ]);
  return result;
}
