import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import {
  acquireFileLock,
  FILE_LOCK_STALE_ERROR_CODE,
  FILE_LOCK_TIMEOUT_ERROR_CODE,
  type FileLockHandle,
  type FileLockOptions,
} from 'openclaw/plugin-sdk/file-lock';

import inspectPrivateArtifact, {
  ensurePrivateFile,
  repairPrivateArtifact,
} from '../utils/private-artifact.ts';

const SUPERVISOR_MARKER_NAME = 'supervisor.json';
const activeMarkers = new Set<string>();

export interface SupervisorOwner {
  hostname: string;
  pid: number;
  port: number;
  profileName: string;
  projectRoot: string;
  runId: string;
  startedAt: string;
  version: 1;
}

export interface SupervisorOwnership {
  lockPath: string;
  markerPath: string;
  owner: SupervisorOwner;
  recoveredStaleOwner: boolean;
  release: () => Promise<void>;
}

type AcquireLock = (path: string, options: FileLockOptions) => Promise<FileLockHandle>;

export interface AcquireSupervisorOwnershipOptions {
  acquireLock?: AcquireLock;
  hostname?: string;
  now?: () => Date;
  pid?: number;
  port: number;
  profileName: string;
  projectRoot: string;
  projectStateRoot: string;
  runId: string;
}

const lockOptions: FileLockOptions = {
  retries: { retries: 0, factor: 1, minTimeout: 0, maxTimeout: 0 },
  stale: 30_000,
};

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return undefined;
  return value as Record<string, unknown>;
}

/** Validates the private metadata associated with one held supervisor lock. */
export function parseSupervisorOwner(value: unknown): SupervisorOwner {
  const owner = recordValue(value);
  if (!owner || owner.version !== 1) {
    throw new TypeError('DevGuard supervisor owner metadata has an unsupported version');
  }
  const stringFields = ['hostname', 'profileName', 'projectRoot', 'runId', 'startedAt'];
  const invalidString = stringFields.find(
    (field) => typeof owner[field] !== 'string' || owner[field].length === 0,
  );
  if (invalidString) {
    throw new TypeError(`DevGuard supervisor owner field ${invalidString} is invalid`);
  }
  if (!Number.isSafeInteger(owner.pid) || (owner.pid as number) < 1) {
    throw new TypeError('DevGuard supervisor owner field pid is invalid');
  }
  if (
    !Number.isSafeInteger(owner.port) ||
    (owner.port as number) < 1 ||
    (owner.port as number) > 65_535
  ) {
    throw new TypeError('DevGuard supervisor owner field port is invalid');
  }
  if (!isAbsolute(owner.projectRoot as string)) {
    throw new TypeError('DevGuard supervisor owner field projectRoot is invalid');
  }
  if (Number.isNaN(Date.parse(owner.startedAt as string))) {
    throw new TypeError('DevGuard supervisor owner field startedAt is invalid');
  }

  return owner as unknown as SupervisorOwner;
}

export function supervisorMarkerPath(projectStateRoot: string): string {
  return join(projectStateRoot, SUPERVISOR_MARKER_NAME);
}

export async function readSupervisorOwner(
  projectStateRoot: string,
): Promise<SupervisorOwner | undefined> {
  const markerPath = supervisorMarkerPath(projectStateRoot);
  const status = await inspectPrivateArtifact(markerPath, 'file');
  if (!status.exists) return undefined;
  if (status.issue) {
    throw new Error(`DevGuard supervisor owner metadata is invalid: ${status.issue}`);
  }
  try {
    return parseSupervisorOwner(JSON.parse(await readFile(markerPath, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function ownershipDetail(owner: SupervisorOwner | undefined): string {
  if (!owner) return 'owner metadata is unavailable';
  return `pid ${owner.pid} on ${owner.hostname} started ${owner.startedAt}`;
}

async function writeOwner(markerPath: string, owner: SupervisorOwner): Promise<void> {
  const temporaryPath = `${markerPath}.${owner.runId}.next`;
  await ensurePrivateFile(temporaryPath);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(owner, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, markerPath);
  } finally {
    await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

/**
 * Acquires the one supervisor lease for a project and writes inspectable private owner metadata.
 * OpenClaw's public file lock owns PID/start-time validation and conservative stale recovery.
 *
 * @throws {Error} When another process owns the project or ownership cannot be verified safely.
 */
export default async function acquireSupervisorOwnership(
  options: AcquireSupervisorOwnershipOptions,
): Promise<SupervisorOwnership> {
  const markerPath = supervisorMarkerPath(options.projectStateRoot);
  if (activeMarkers.has(markerPath)) {
    throw new Error(
      'DevGuard supervision is already active for this project in the current process',
    );
  }

  let previousOwner: SupervisorOwner | undefined;
  let previousOwnerError: unknown;
  try {
    previousOwner = await readSupervisorOwner(options.projectStateRoot);
  } catch (error) {
    previousOwnerError = error;
  }

  const acquireLock = options.acquireLock ?? acquireFileLock;
  let lock: FileLockHandle;
  try {
    lock = await acquireLock(markerPath, lockOptions);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== FILE_LOCK_TIMEOUT_ERROR_CODE && code !== FILE_LOCK_STALE_ERROR_CODE) throw error;
    const detail = previousOwnerError
      ? 'owner metadata is malformed or unreadable'
      : ownershipDetail(previousOwner);
    throw new Error(
      `DevGuard supervision is already active or cannot be recovered safely (${detail}); stop the existing supervisor before retrying`,
      { cause: error },
    );
  }

  activeMarkers.add(markerPath);
  const owner: SupervisorOwner = {
    version: 1,
    hostname: options.hostname ?? hostname(),
    pid: options.pid ?? process.pid,
    port: options.port,
    profileName: options.profileName,
    projectRoot: resolve(options.projectRoot),
    runId: options.runId,
    startedAt: (options.now ?? (() => new Date()))().toISOString(),
  };

  try {
    await repairPrivateArtifact(lock.lockPath, 'file');
    await writeOwner(markerPath, owner);
  } catch (error) {
    activeMarkers.delete(markerPath);
    await lock.release();
    throw error;
  }

  let released = false;
  return {
    lockPath: lock.lockPath,
    markerPath,
    owner,
    recoveredStaleOwner: previousOwner !== undefined || previousOwnerError !== undefined,
    async release() {
      if (released) return;
      released = true;
      let releaseError: unknown;
      try {
        const current = await readSupervisorOwner(options.projectStateRoot);
        if (!current || current.runId !== owner.runId) {
          throw new Error(
            'DevGuard supervisor owner changed before release; preserving its metadata',
          );
        }
        await unlink(markerPath);
      } catch (error) {
        releaseError = error;
      } finally {
        activeMarkers.delete(markerPath);
        await lock.release();
      }
      if (releaseError) throw releaseError;
    },
  };
}
