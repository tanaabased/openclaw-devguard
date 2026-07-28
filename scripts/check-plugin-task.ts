import { readFile } from 'node:fs/promises';

import pluginMetadataFailures, {
  type PackageMetadata,
  type PluginManifest,
} from '../utils/plugin-metadata-failures.ts';

const packageMetadata = JSON.parse(await readFile('package.json', 'utf8')) as PackageMetadata;
const manifest = JSON.parse(await readFile('openclaw.plugin.json', 'utf8')) as PluginManifest;
const failures = pluginMetadataFailures(packageMetadata, manifest);

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`plugin check: ${failure}\n`);
  process.exit(1);
}

process.stdout.write('plugin check: ok\n');
