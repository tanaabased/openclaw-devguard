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

export type PluginMetadataFailureCode =
  | 'package-name'
  | 'plugin-id'
  | 'version-mismatch'
  | 'source-entry'
  | 'runtime-entry'
  | 'startup-activation'
  | 'cli-command'
  | 'config-schema-type'
  | 'config-schema-strictness';

export interface PluginMetadataFailure {
  code: PluginMetadataFailureCode;
  message: string;
}

export default function pluginMetadataFailures(
  packageMetadata: PackageMetadata,
  manifest: PluginManifest,
): PluginMetadataFailure[] {
  const failures: PluginMetadataFailure[] = [];
  const check = (condition: boolean, code: PluginMetadataFailureCode, message: string): void => {
    if (!condition) failures.push({ code, message });
  };

  check(
    packageMetadata.name === '@tanaab/openclaw-devguard',
    'package-name',
    'unexpected npm package name',
  );
  check(manifest.id === 'openclaw-devguard', 'plugin-id', 'unexpected OpenClaw plugin id');
  check(
    packageMetadata.version === manifest.version,
    'version-mismatch',
    'package and manifest versions differ',
  );
  check(
    packageMetadata.openclaw?.extensions?.includes('./index.ts') === true,
    'source-entry',
    'source entry missing',
  );
  check(
    packageMetadata.openclaw?.runtimeExtensions?.includes('./dist/index.js') === true,
    'runtime-entry',
    'runtime entry missing',
  );
  check(
    manifest.activation?.onStartup === true,
    'startup-activation',
    'plugin must activate on startup',
  );
  check(
    manifest.commandAliases?.some((alias) => alias.name === 'devguard' && alias.kind === 'cli') ===
      true,
    'cli-command',
    'CLI command ownership is missing',
  );
  check(
    manifest.configSchema?.type === 'object',
    'config-schema-type',
    'config schema must describe an object',
  );
  check(
    manifest.configSchema?.additionalProperties === false,
    'config-schema-strictness',
    'config schema must be strict',
  );
  return failures;
}
