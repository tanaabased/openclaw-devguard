import { readFile } from 'node:fs/promises';

interface PackageMetadata {
  name?: string;
  version?: string;
  openclaw?: {
    extensions?: string[];
    runtimeExtensions?: string[];
  };
}

interface PluginManifest {
  id?: string;
  version?: string;
  activation?: { onStartup?: boolean; onCommands?: string[] };
  configSchema?: { type?: string; additionalProperties?: boolean; properties?: object };
}

const packageMetadata = JSON.parse(await readFile('package.json', 'utf8')) as PackageMetadata;
const manifest = JSON.parse(await readFile('openclaw.plugin.json', 'utf8')) as PluginManifest;
const failures: string[] = [];

const check = (condition: boolean, message: string): void => {
  if (!condition) failures.push(message);
};

check(packageMetadata.name === '@tanaabased/openclaw-devguard', 'unexpected npm package name');
check(manifest.id === 'openclaw-devguard', 'unexpected OpenClaw plugin id');
check(packageMetadata.version === manifest.version, 'package and manifest versions differ');
check(
  packageMetadata.openclaw?.extensions?.includes('./index.ts') === true,
  'source entry missing',
);
check(
  packageMetadata.openclaw?.runtimeExtensions?.includes('./dist/index.js') === true,
  'runtime entry missing',
);
check(manifest.activation?.onStartup === false, 'plugin must not activate on startup');
check(manifest.activation?.onCommands?.includes('devguard') === true, 'command activation missing');
check(manifest.configSchema?.type === 'object', 'config schema must describe an object');
check(manifest.configSchema?.additionalProperties === false, 'config schema must be strict');
check(
  Object.keys(manifest.configSchema?.properties ?? {}).length === 0,
  'structural scaffold must not expose config',
);

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`plugin check: ${failure}\n`);
  process.exit(1);
}

process.stdout.write('plugin check: ok\n');
