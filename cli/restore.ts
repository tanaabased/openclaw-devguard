import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  defaultCliOutput,
  formatCliAction,
  formatCliField,
  formatCliTarget,
  type CliOutput,
  writeCliLines,
} from '../lib/cli-output.ts';
import { type Logger, reportError } from '../lib/logger.ts';
import { findProjectRoot, readProjectConfig, resolveProjectPaths } from '../lib/project-config.ts';
import createRuntimeEventRecorder from '../lib/runtime-events.ts';
import parseRestoreMarker, { type RestoreMarker } from '../utils/restore-marker.ts';

export interface RestoreDevguardOptions {
  environment?: NodeJS.ProcessEnv;
  logger: Logger;
  output?: CliOutput;
}

export interface RestoreDevguardResult {
  changed: boolean;
  logPath: string;
  profileName: string;
  restoredSnapshot: boolean;
  stateDirectory: string;
}

async function readMarker(
  markerPath: string,
  projectStateRoot: string,
  stateDirectory: string,
  profileName: string,
): Promise<RestoreMarker | undefined> {
  try {
    return parseRestoreMarker(
      JSON.parse(await readFile(markerPath, 'utf8')),
      projectStateRoot,
      stateDirectory,
      profileName,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function writeMarker(path: string, marker: RestoreMarker): Promise<void> {
  const temporaryPath = `${path}.next`;
  await writeFile(temporaryPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, path);
}

async function restoreSnapshot(snapshotPath: string, configPath: string): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  const temporaryPath = `${configPath}.devguard-restore`;
  await copyFile(snapshotPath, temporaryPath);
  await rename(temporaryPath, configPath);
}

export default async function restoreDevguard(
  projectRoot: string,
  options: RestoreDevguardOptions,
): Promise<RestoreDevguardResult> {
  const root = await findProjectRoot(projectRoot);
  const environment = options.environment ?? process.env;
  const config = await readProjectConfig(root);
  const paths = resolveProjectPaths(root, config.plugin.id, environment);
  const markerPath = join(paths.projectStateRoot, 'init.json');
  const snapshotPath = join(paths.projectStateRoot, 'openclaw.before-devguard.json');
  const tokenPath = join(paths.projectStateRoot, 'gateway-token');
  const marker = await readMarker(
    markerPath,
    paths.projectStateRoot,
    paths.stateDirectory,
    paths.profileName,
  );
  const result: RestoreDevguardResult = {
    changed: marker !== undefined,
    logPath: paths.logPath,
    profileName: paths.profileName,
    restoredSnapshot: marker?.snapshotPath !== undefined,
    stateDirectory: paths.stateDirectory,
  };

  if (marker && marker.phase !== 'restored') {
    if (marker.snapshotPath) await readFile(marker.snapshotPath, 'utf8');
    await writeMarker(markerPath, { ...marker, phase: 'restoring' });
    await rm(paths.stateDirectory, { force: true, recursive: true });
    if (marker.snapshotPath) await restoreSnapshot(marker.snapshotPath, marker.configPath);
    await writeMarker(markerPath, { ...marker, phase: 'restored' });
  }

  if (marker) {
    await Promise.all([
      rm(tokenPath, { force: true }),
      rm(snapshotPath, { force: true }),
      rm(`${markerPath}.next`, { force: true }),
    ]);
    await rm(markerPath, { force: true });

    const events = createRuntimeEventRecorder({
      base: { pluginId: config.plugin.id, runId: randomUUID() },
      logPath: paths.logPath,
      onError: (error) => reportError(options.logger, 'could not append a restore event', error),
    });
    events.record({
      event: 'configuration_restored',
      restoredSnapshot: result.restoredSnapshot,
      stateDirectory: paths.stateDirectory,
    });
    await events.flush();
  }

  const output = options.output ?? defaultCliOutput;
  writeCliLines(output, [
    formatCliAction(marker ? 'restored' : 'unchanged', config.plugin.id),
    formatCliTarget('profile', paths.profileName),
    formatCliTarget('state', paths.stateDirectory),
    formatCliField(
      'config',
      marker ? (result.restoredSnapshot ? 'restored' : 'removed') : 'unchanged',
    ),
    formatCliField('logs', 'preserved'),
  ]);
  return result;
}
