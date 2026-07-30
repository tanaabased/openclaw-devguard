import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { defaultCliOutput, type CliOutput } from '../lib/cli-output.ts';
import { findProjectRoot, readProjectConfig, resolveProjectPaths } from '../lib/project-config.ts';
import parseRestoreMarker from '../utils/restore-marker.ts';
import assertSupportedHost from '../utils/supported-host.ts';

export interface ProfileDevguardOptions {
  environment?: NodeJS.ProcessEnv;
  output?: CliOutput;
  platform?: NodeJS.Platform;
}

export default async function profileDevguard(
  projectRoot: string,
  options: ProfileDevguardOptions = {},
): Promise<string> {
  assertSupportedHost(options.platform);
  const root = await findProjectRoot(projectRoot);
  const environment = options.environment ?? process.env;
  const config = await readProjectConfig(root);
  const paths = resolveProjectPaths(root, config.plugin.id, environment);
  const marker = JSON.parse(await readFile(join(paths.projectStateRoot, 'init.json'), 'utf8'));

  parseRestoreMarker(marker, paths.projectStateRoot, paths.stateDirectory, paths.profileName);

  (options.output ?? defaultCliOutput).writeStdout(`${paths.profileName}\n`);
  return paths.profileName;
}
