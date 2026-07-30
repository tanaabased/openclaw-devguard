import { appendFile, chmod, lstat, mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';

export type PrivateArtifactKind = 'directory' | 'file';

export interface PrivateArtifactStatus {
  exists: boolean;
  issue?: string;
  kind: PrivateArtifactKind;
  mode?: number;
  path: string;
}

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const GROUP_OR_OTHER_MODE = 0o077;

function displayMode(mode: number): string {
  return mode.toString(8).padStart(4, '0');
}

export default async function inspectPrivateArtifact(
  path: string,
  kind: PrivateArtifactKind,
): Promise<PrivateArtifactStatus> {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false, kind, path };
    throw error;
  }

  if (stats.isSymbolicLink()) {
    return { exists: true, issue: 'symbolic links are not allowed', kind, path };
  }
  if (kind === 'directory' ? !stats.isDirectory() : !stats.isFile()) {
    return { exists: true, issue: `expected a ${kind}`, kind, path };
  }

  const mode = stats.mode & 0o777;
  return {
    exists: true,
    kind,
    mode,
    path,
    ...(mode & GROUP_OR_OTHER_MODE
      ? { issue: `mode ${displayMode(mode)} grants group or other access` }
      : {}),
  };
}

function invalidArtifact(status: PrivateArtifactStatus): Error {
  return new Error(`DevGuard private ${status.kind} is invalid: ${status.path}: ${status.issue}`);
}

export async function repairPrivateArtifact(
  path: string,
  kind: PrivateArtifactKind,
): Promise<PrivateArtifactStatus> {
  const status = await inspectPrivateArtifact(path, kind);
  if (!status.exists || !status.issue) return status;
  if (status.mode === undefined) throw invalidArtifact(status);

  await chmod(path, status.mode & ~GROUP_OR_OTHER_MODE);
  return inspectPrivateArtifact(path, kind);
}

export async function ensurePrivateDirectory(path: string): Promise<void> {
  const status = await inspectPrivateArtifact(path, 'directory');
  if (!status.exists) await mkdir(path, { mode: PRIVATE_DIRECTORY_MODE, recursive: true });
  const secured = await repairPrivateArtifact(path, 'directory');
  if (secured.issue) throw invalidArtifact(secured);
}

export async function ensurePrivateFile(path: string): Promise<void> {
  const status = await inspectPrivateArtifact(path, 'file');
  if (!status.exists) {
    await ensurePrivateDirectory(dirname(path));
    const handle = await open(path, 'a', PRIVATE_FILE_MODE);
    await handle.close();
  }
  const secured = await repairPrivateArtifact(path, 'file');
  if (secured.issue) throw invalidArtifact(secured);
}

export async function appendPrivateFile(path: string, contents: string): Promise<void> {
  await ensurePrivateFile(path);
  await appendFile(path, contents, { encoding: 'utf8', mode: PRIVATE_FILE_MODE });
}
