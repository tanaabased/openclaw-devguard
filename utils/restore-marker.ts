import { join, resolve } from 'node:path';

export interface RestoreMarker {
  configPath: string;
  phase?: 'restoring' | 'restored';
  snapshotPath?: string;
  version: 1;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError('DevGuard initialization marker must be an object');
  }
  return value as Record<string, unknown>;
}

/** Validates that restore metadata can only reference DevGuard-owned canonical paths. */
export default function parseRestoreMarker(
  value: unknown,
  projectStateRoot: string,
  stateDirectory: string,
): RestoreMarker {
  const marker = record(value);
  if (marker.version !== 1) throw new Error('DevGuard initialization marker version must be 1');

  const configPath = resolve(join(stateDirectory, 'openclaw.json'));
  if (marker.configPath !== configPath) {
    throw new Error('DevGuard initialization marker references an unexpected config path');
  }

  const canonicalSnapshotPath = resolve(join(projectStateRoot, 'openclaw.before-devguard.json'));
  const snapshotPath = marker.snapshotPath;
  if (
    snapshotPath !== null &&
    snapshotPath !== undefined &&
    snapshotPath !== canonicalSnapshotPath
  ) {
    throw new Error('DevGuard initialization marker references an unexpected snapshot path');
  }

  const phase = marker.phase;
  if (phase !== undefined && phase !== 'restoring' && phase !== 'restored') {
    throw new Error('DevGuard initialization marker has an unknown restore phase');
  }

  return {
    version: 1,
    configPath,
    ...(typeof snapshotPath === 'string' ? { snapshotPath } : {}),
    ...(phase ? { phase } : {}),
  };
}
