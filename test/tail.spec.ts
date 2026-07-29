import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import tailDevguard from '../cli/tail.ts';
import { createCliStyles } from '../lib/cli-output.ts';
import { type Logger } from '../lib/logger.ts';
import { resolveProjectPaths } from '../lib/project-config.ts';

const config = {
  version: 1,
  plugin: {
    id: 'example-plugin',
    build: { command: 'bun', args: ['run', 'build'] },
    watch: ['index.ts'],
  },
  policy: { mode: 'probe' },
  logging: { environmentValueAllowlist: [] },
  gateway: { port: 19_001 },
};

describe('cli/tail', () => {
  it('should render human events and continue past malformed records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-tail-'));
    const devguardHome = join(root, 'home');
    const paths = resolveProjectPaths(root, config.plugin.id, { DEVGUARD_HOME: devguardHome });
    const nested = join(root, 'examples', 'tail');
    const writes: string[] = [];
    const warnings: string[] = [];
    const logger: Logger = {
      info() {},
      warn: (message) => warnings.push(message),
      error() {},
    };

    try {
      await Promise.all([
        mkdir(dirname(paths.logPath), { recursive: true }),
        mkdir(nested, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(join(root, 'devguard.json'), JSON.stringify(config)),
        writeFile(
          paths.logPath,
          `${JSON.stringify({
            event: 'tool_call_attempted',
            params: { command: 'touch sentinel' },
            toolName: 'exec',
          })}\nnot-json\n`,
        ),
      ]);

      await tailDevguard(nested, {
        environment: { DEVGUARD_HOME: devguardHome },
        follow: false,
        logger,
        output: { writeStdout: (value) => writes.push(value) },
        styles: createCliStyles({ NO_COLOR: '' }),
      });

      assert.deepEqual(writes, ['tool call attempted exec touch sentinel\n']);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0] ?? '', /malformed audit record/);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('should preserve underlying JSONL records in JSON mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-tail-json-'));
    const devguardHome = join(root, 'home');
    const paths = resolveProjectPaths(root, config.plugin.id, { DEVGUARD_HOME: devguardHome });
    const line = JSON.stringify({ event: 'build_succeeded', pluginBuildId: 'build-1' });
    const writes: string[] = [];
    const logger: Logger = { info() {}, warn() {}, error() {} };

    try {
      await mkdir(dirname(paths.logPath), { recursive: true });
      await Promise.all([
        writeFile(join(root, 'devguard.json'), JSON.stringify(config)),
        writeFile(paths.logPath, `${line}\n`),
      ]);

      await tailDevguard(root, {
        environment: { DEVGUARD_HOME: devguardHome },
        follow: false,
        json: true,
        logger,
        output: { writeStdout: (value) => writes.push(value) },
      });

      assert.deepEqual(writes, [`${line}\n`]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
