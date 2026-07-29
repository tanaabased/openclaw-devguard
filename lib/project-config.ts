import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export const DEVGUARD_PROJECT_FILE = 'devguard.json';

export interface DevguardProjectConfig {
  version: 1;
  plugin: {
    id: string;
    build: {
      command: string;
      args: string[];
    };
    validate?: {
      command: string;
      args: string[];
    };
    watch: string[];
  };
  logging: {
    environmentValueAllowlist: string[];
  };
  gateway: {
    port: number;
  };
}

interface PackageMetadata {
  packageManager?: string;
  scripts?: Record<string, string>;
}

interface PluginManifest {
  id?: string;
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${path} contains unknown keys: ${unknown.join(', ')}`);
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`${path} must be an array of strings`);
  }
  return value;
}

function commandConfig(value: unknown, path: string): DevguardProjectConfig['plugin']['build'] {
  const command = record(value, path);
  assertExactKeys(command, ['command', 'args'], path);
  if (typeof command.command !== 'string' || command.command.length === 0) {
    throw new TypeError(`${path}.command must be a non-empty string`);
  }
  return {
    command: command.command,
    args: stringArray(command.args, `${path}.args`),
  };
}

export function parseProjectConfig(value: unknown): DevguardProjectConfig {
  const config = record(value, DEVGUARD_PROJECT_FILE);
  assertExactKeys(config, ['version', 'plugin', 'logging', 'gateway'], DEVGUARD_PROJECT_FILE);
  if (config.version !== 1) throw new Error(`${DEVGUARD_PROJECT_FILE} version must be 1`);

  const plugin = record(config.plugin, 'plugin');
  assertExactKeys(plugin, ['id', 'build', 'validate', 'watch'], 'plugin');
  if (typeof plugin.id !== 'string' || plugin.id.length === 0) {
    throw new TypeError('plugin.id must be a non-empty string');
  }
  const build = commandConfig(plugin.build, 'plugin.build');
  const validate =
    plugin.validate === undefined ? undefined : commandConfig(plugin.validate, 'plugin.validate');

  const logging = record(config.logging, 'logging');
  assertExactKeys(logging, ['environmentValueAllowlist'], 'logging');
  const gateway = record(config.gateway, 'gateway');
  assertExactKeys(gateway, ['port'], 'gateway');
  if (
    typeof gateway.port !== 'number' ||
    !Number.isInteger(gateway.port) ||
    gateway.port < 1 ||
    gateway.port > 65_535
  ) {
    throw new TypeError('gateway.port must be an integer between 1 and 65535');
  }

  return {
    version: 1,
    plugin: {
      id: plugin.id,
      build,
      ...(validate ? { validate } : {}),
      watch: stringArray(plugin.watch, 'plugin.watch'),
    },
    logging: {
      environmentValueAllowlist: stringArray(
        logging.environmentValueAllowlist,
        'logging.environmentValueAllowlist',
      ),
    },
    gateway: { port: gateway.port },
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function inferBuild(packageMetadata: PackageMetadata): DevguardProjectConfig['plugin']['build'] {
  const scripts = packageMetadata.scripts ?? {};
  const scriptName = ['plugin:build', 'build'].find((candidate) => scripts[candidate]);
  if (!scriptName) {
    throw new Error('plugin package.json must define a build or plugin:build script');
  }

  const packageManager = packageMetadata.packageManager?.split('@')[0] ?? 'npm';
  const command = ['bun', 'npm', 'pnpm', 'yarn'].includes(packageManager) ? packageManager : 'npm';
  return { command, args: ['run', scriptName] };
}

function inferValidation(
  packageMetadata: PackageMetadata,
): DevguardProjectConfig['plugin']['validate'] {
  const scripts = packageMetadata.scripts ?? {};
  const scriptName = ['plugin:check', 'plugin:validate', 'validate'].find(
    (candidate) => scripts[candidate],
  );
  if (!scriptName) return undefined;

  const packageManager = packageMetadata.packageManager?.split('@')[0] ?? 'npm';
  const command = ['bun', 'npm', 'pnpm', 'yarn'].includes(packageManager) ? packageManager : 'npm';
  return { command, args: ['run', scriptName] };
}

async function inferWatchPaths(pluginRoot: string): Promise<string[]> {
  const candidates = [
    'src',
    'cli',
    'lib',
    'utils',
    'index.ts',
    'index.js',
    'index.mjs',
    'openclaw.plugin.json',
    'package.json',
    'tsconfig.json',
  ];
  const checks = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      present: await exists(join(pluginRoot, candidate)),
    })),
  );
  return checks.filter(({ present }) => present).map(({ candidate }) => candidate);
}

export async function createProjectConfig(pluginRoot: string): Promise<DevguardProjectConfig> {
  const [packageContents, manifestContents] = await Promise.all([
    readFile(join(pluginRoot, 'package.json'), 'utf8'),
    readFile(join(pluginRoot, 'openclaw.plugin.json'), 'utf8'),
  ]);
  const packageMetadata = JSON.parse(packageContents) as PackageMetadata;
  const manifest = JSON.parse(manifestContents) as PluginManifest;
  if (typeof manifest.id !== 'string' || manifest.id.length === 0) {
    throw new Error('openclaw.plugin.json must declare a non-empty plugin id');
  }
  const validate = inferValidation(packageMetadata);

  return {
    version: 1,
    plugin: {
      id: manifest.id,
      build: inferBuild(packageMetadata),
      ...(validate ? { validate } : {}),
      watch: await inferWatchPaths(pluginRoot),
    },
    logging: { environmentValueAllowlist: [] },
    gateway: { port: 19_001 },
  };
}

export async function readProjectConfig(pluginRoot: string): Promise<DevguardProjectConfig> {
  const contents = await readFile(join(pluginRoot, DEVGUARD_PROJECT_FILE), 'utf8');
  return parseProjectConfig(JSON.parse(contents));
}

export async function ensureProjectConfig(pluginRoot: string): Promise<{
  config: DevguardProjectConfig;
  created: boolean;
}> {
  const path = join(pluginRoot, DEVGUARD_PROJECT_FILE);
  if (await exists(path)) return { config: await readProjectConfig(pluginRoot), created: false };

  const config = await createProjectConfig(pluginRoot);
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return { config, created: true };
}

export function resolveProjectPaths(
  pluginRoot: string,
  pluginId: string,
  environment: NodeJS.ProcessEnv = process.env,
): { projectStateRoot: string; stateDirectory: string; logPath: string } {
  const normalizedRoot = resolve(pluginRoot);
  const hash = createHash('sha256').update(normalizedRoot).digest('hex').slice(0, 12);
  const slug = `${basename(pluginId).replace(/[^a-zA-Z0-9._-]+/g, '-')}-${hash}`;
  const devguardHome = environment.DEVGUARD_HOME ?? join(homedir(), '.openclaw-dev', 'devguard');
  const projectStateRoot = join(devguardHome, 'projects', slug);

  return {
    projectStateRoot,
    stateDirectory: join(projectStateRoot, 'state'),
    logPath: join(projectStateRoot, 'logs', 'events.jsonl'),
  };
}
