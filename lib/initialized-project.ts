import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  findProjectRoot,
  readProjectConfig,
  resolveProjectPaths,
  type DevguardProjectPaths,
} from './project-config.ts';
import parseRestoreMarker from '../utils/restore-marker.ts';

export interface InitializedProject {
  paths: DevguardProjectPaths;
  root: string;
}

export default async function loadInitializedProject(
  projectRoot: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<InitializedProject> {
  const root = await findProjectRoot(projectRoot);
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

  return { paths, root };
}
