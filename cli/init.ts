import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
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

export interface InitDevguardOptions {
  environment?: NodeJS.ProcessEnv;
  logger: Logger;
  output?: CliOutput;
  pluginRoot?: string;
}

export interface InitDevguardResult {
  config: DevguardProjectConfig;
  configCreated: boolean;
  pluginRoot: string;
  stateDirectory: string;
  logPath: string;
  snapshotPath?: string;
}

async function configureIsolatedState(
  stateDirectory: string,
  port: number,
  environment: NodeJS.ProcessEnv,
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
  const patch = {
    gateway: {
      mode: 'local',
      bind: 'loopback',
      auth: { mode: 'token', token: gatewayToken },
      port,
    },
    tools: { exec: { mode: 'deny' }, elevated: { enabled: false } },
    agents: { defaults: { sandbox: { mode: 'all', workspaceAccess: 'none' } } },
  };
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
    const marker = JSON.parse(await readFile(markerPath, 'utf8')) as {
      snapshotPath?: string | null;
    };
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
  const snapshotPath = await snapshotConfiguration(paths.projectStateRoot, paths.stateDirectory);
  await configureIsolatedState(paths.stateDirectory, config.gateway.port, environment);

  logDebug(options.logger, `building plugin ${config.plugin.id}`);
  await processCommand(config.plugin.build.command, config.plugin.build.args, {
    cwd: pluginRoot,
    env: environment,
    inherit: true,
  });

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
    snapshotPath,
  };
  const output = options.output ?? defaultCliOutput;
  writeCliLines(output, [
    formatCliAction('initialized', result.config.plugin.id),
    formatCliTarget('project', result.pluginRoot),
    formatCliTarget('state', result.stateDirectory),
    formatCliTarget('log', result.logPath),
    formatCliField('config', result.configCreated ? 'created' : 'reused'),
    formatCliTarget('next', 'openclaw devguard run'),
  ]);
  return result;
}
