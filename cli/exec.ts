import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { readProjectConfig, resolveProjectPaths } from '../lib/project-config.ts';
import processCommand, {
  type ProcessCommandOptions,
  type ProcessCommandResult,
} from '../lib/process-command.ts';
import isolatedOpenClawEnvironment, {
  openClawProfileArguments,
} from '../utils/isolated-openclaw-environment.ts';
import parseRestoreMarker from '../utils/restore-marker.ts';

export type ExecCommandRunner = (
  command: string,
  args: readonly string[],
  options?: ProcessCommandOptions,
) => Promise<ProcessCommandResult>;

export interface ExecDevguardOptions {
  environment?: NodeJS.ProcessEnv;
  runCommand?: ExecCommandRunner;
}

export default async function execDevguard(
  projectRoot: string,
  openClawArguments: readonly string[],
  options: ExecDevguardOptions = {},
): Promise<number> {
  if (openClawArguments.length === 0) {
    throw new Error('OpenClaw command arguments are required after --');
  }

  const root = resolve(projectRoot);
  const environment = options.environment ?? process.env;
  const config = await readProjectConfig(root);
  const paths = resolveProjectPaths(root, config.plugin.id, environment);
  try {
    parseRestoreMarker(
      JSON.parse(await readFile(join(paths.projectStateRoot, 'init.json'), 'utf8')),
      paths.projectStateRoot,
      paths.stateDirectory,
      paths.profileName,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('DevGuard isolated state is not initialized; run init again', {
        cause: error,
      });
    }
    throw error;
  }

  const result = await (options.runCommand ?? processCommand)(
    'openclaw',
    openClawProfileArguments(paths.profileName, openClawArguments),
    {
      allowFailure: true,
      cwd: root,
      env: isolatedOpenClawEnvironment(
        environment,
        { profileName: paths.profileName, stateDirectory: paths.stateDirectory },
        { OPENCLAW_SKIP_CHANNELS: '1' },
      ),
      inherit: true,
      inheritStdin: true,
    },
  );

  return result.code;
}
