import assert from 'node:assert/strict';
import { chmod, lstat, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import inspectPrivateArtifact, {
  appendPrivateFile,
  ensurePrivateDirectory,
  ensurePrivateFile,
  repairPrivateArtifact,
} from '../utils/private-artifact.ts';

async function mode(path: string): Promise<number> {
  return (await lstat(path)).mode & 0o777;
}

describe('utils/private-artifact', () => {
  it('should create owner-only directories and files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-private-create-'));
    const directory = join(root, 'state');
    const file = join(directory, 'events.jsonl');

    try {
      await ensurePrivateDirectory(directory);
      await ensurePrivateFile(file);

      assert.equal(await mode(directory), 0o700);
      assert.equal(await mode(file), 0o600);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('should remove broad access without widening stricter owner permissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-private-repair-'));
    const directory = join(root, 'state');
    const file = join(directory, 'events.jsonl');

    try {
      await ensurePrivateDirectory(directory);
      await writeFile(file, '', { mode: 0o600 });
      await chmod(directory, 0o755);
      await chmod(file, 0o644);

      assert.match(
        (await inspectPrivateArtifact(directory, 'directory')).issue ?? '',
        /group or other/,
      );
      assert.match((await inspectPrivateArtifact(file, 'file')).issue ?? '', /group or other/);

      await repairPrivateArtifact(directory, 'directory');
      await repairPrivateArtifact(file, 'file');
      assert.equal(await mode(directory), 0o700);
      assert.equal(await mode(file), 0o600);

      await chmod(directory, 0o500);
      await chmod(file, 0o400);
      await repairPrivateArtifact(directory, 'directory');
      await repairPrivateArtifact(file, 'file');
      assert.equal(await mode(directory), 0o500);
      assert.equal(await mode(file), 0o400);
    } finally {
      await chmod(directory, 0o700);
      await rm(root, { force: true, recursive: true });
    }
  });

  it('should reject symbolic links instead of changing their targets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-private-link-'));
    const target = join(root, 'target');
    const link = join(root, 'link');

    try {
      await writeFile(target, 'preserved', { mode: 0o644 });
      await symlink(target, link);

      await assert.rejects(ensurePrivateFile(link), /symbolic links are not allowed/);
      assert.equal(await mode(target), 0o644);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('should reject an unexpected artifact type', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-private-type-'));
    const path = join(root, 'events.jsonl');

    try {
      await ensurePrivateDirectory(path);

      await assert.rejects(ensurePrivateFile(path), /expected a file/);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('should append through an owner-only file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-private-append-'));
    const file = join(root, 'logs', 'events.jsonl');

    try {
      await appendPrivateFile(file, '{"event":"created"}\n');

      assert.equal(await mode(join(root, 'logs')), 0o700);
      assert.equal(await mode(file), 0o600);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
