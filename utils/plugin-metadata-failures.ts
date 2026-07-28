export interface PackageMetadata {
  engines?: {
    node?: string;
  };
  name?: string;
  version?: string;
  openclaw?: {
    extensions?: string[];
    runtimeExtensions?: string[];
  };
}

export interface PluginManifest {
  id?: string;
  version?: string;
  activation?: { onStartup?: boolean; onCommands?: string[] };
  commandAliases?: Array<{ name?: string; kind?: string }>;
  configSchema?: {
    type?: string;
    additionalProperties?: boolean;
    properties?: Record<string, unknown>;
  };
}

export default function pluginMetadataFailures(
  packageMetadata: PackageMetadata,
  manifest: PluginManifest,
): string[] {
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
  check(manifest.activation?.onStartup === true, 'plugin must activate on startup');
  check(
    manifest.commandAliases?.some((alias) => alias.name === 'devguard' && alias.kind === 'cli') ===
      true,
    'CLI command ownership is missing',
  );
  check(manifest.configSchema?.type === 'object', 'config schema must describe an object');
  check(manifest.configSchema?.additionalProperties === false, 'config schema must be strict');
  check(manifest.configSchema?.properties?.logging !== undefined, 'logging config is missing');

  return failures;
}
