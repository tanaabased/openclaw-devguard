import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import doctorDevguard from '../cli/doctor.ts';
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

describe('cli/doctor', () => {
  it('should aggregate DevGuard and OpenClaw checks into one passing report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devguard-doctor-'));
    const devguardHome = join(root, 'home');
    const environment = { DEVGUARD_HOME: devguardHome, HOME: join(root, 'user-home') };
    const paths = resolveProjectPaths(root, config.plugin.id, environment);
    const nested = join(root, 'examples', 'doctor');
    const writes: string[] = [];
    const commands: string[][] = [];
    const logger: Logger = { info() {}, warn() {}, error() {} };
    const stateConfig = {
      gateway: {
        mode: 'local',
        bind: 'loopback',
        auth: { mode: 'token', token: 'secret' },
        port: 19_001,
      },
      tools: { exec: { host: 'gateway', mode: 'full' }, elevated: { enabled: false } },
      agents: {
        defaults: {
          model: 'openai/gpt-test',
          models: { 'openai/gpt-test': { agentRuntime: { id: 'openclaw' } } },
          sandbox: { mode: 'off' },
        },
        list: [{ id: 'main', agentDir: join(paths.stateDirectory, 'agents/main/agent') }],
      },
    };

    try {
      await Promise.all([
        mkdir(paths.stateDirectory, { recursive: true }),
        mkdir(dirname(paths.logPath), { recursive: true }),
        mkdir(nested, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(join(root, 'devguard.json'), JSON.stringify(config)),
        writeFile(join(root, 'openclaw.plugin.json'), JSON.stringify({ id: 'example-plugin' })),
        writeFile(
          join(paths.projectStateRoot, 'init.json'),
          JSON.stringify({
            version: 2,
            profileName: paths.profileName,
            configPath: join(paths.stateDirectory, 'openclaw.json'),
            snapshotPath: null,
            profileImport: { agentIds: ['main'] },
          }),
        ),
        writeFile(join(paths.projectStateRoot, 'gateway-token'), 'gateway-secret\n'),
        writeFile(join(paths.stateDirectory, 'openclaw.json'), JSON.stringify(stateConfig)),
        writeFile(
          paths.logPath,
          `${JSON.stringify({ event: 'build_succeeded', pluginBuildId: 'build-1' })}\n`,
        ),
      ]);

      await doctorDevguard(nested, {
        environment,
        logger,
        output: { writeStdout: (value) => writes.push(value) },
        queryStatus: async ({ token, url }) => {
          assert.equal(token, 'gateway-secret');
          assert.equal(url, 'ws://127.0.0.1:19001');
          return {
            ambientChannelsDisabled: true,
            denyUnknownTools: true,
            hookRegistered: true,
            pluginBuildId: 'build-1',
            pluginId: 'example-plugin',
            policyMode: 'probe',
            profileName: paths.profileName,
            stateDirectory: paths.stateDirectory,
          };
        },
        runCommand: async (command, args, options) => {
          assert.equal(command, 'openclaw');
          assert.equal(
            options?.env?.OPENCLAW_CONFIG_PATH,
            join(paths.stateDirectory, 'openclaw.json'),
          );
          assert.equal(options?.env?.OPENCLAW_PROFILE, paths.profileName);
          assert.equal(options?.env?.OPENCLAW_STATE_DIR, paths.stateDirectory);
          commands.push([...args]);
          const profileArgs = args.slice(2);
          if (profileArgs[0] === 'config' && profileArgs[2] === 'gateway') {
            return { code: 0, output: JSON.stringify(stateConfig.gateway) };
          }
          if (profileArgs[0] === 'config' && profileArgs[2] === 'tools') {
            return { code: 0, output: JSON.stringify(stateConfig.tools) };
          }
          if (profileArgs[0] === 'config' && profileArgs[2] === 'agents.defaults') {
            return {
              code: 0,
              output: JSON.stringify(stateConfig.agents.defaults),
            };
          }
          if (profileArgs[0] === 'config' && profileArgs[2] === 'agents.list') {
            return { code: 0, output: JSON.stringify(stateConfig.agents.list) };
          }
          return { code: 0, output: '{}' };
        },
        styles: createCliStyles({ NO_COLOR: '' }),
      });

      assert.equal(writes.length, 1);
      assert.equal(writes[0]?.split('\n').filter(Boolean).length, 21);
      assert.match(writes[0] ?? '', /^pass\s+initialized state/m);
      assert.deepEqual(commands, [
        ['--profile', paths.profileName, 'config', 'get', 'gateway', '--json'],
        ['--profile', paths.profileName, 'config', 'get', 'tools', '--json'],
        ['--profile', paths.profileName, 'config', 'get', 'agents.defaults', '--json'],
        ['--profile', paths.profileName, 'config', 'get', 'agents.list', '--json'],
        [
          '--profile',
          paths.profileName,
          'plugins',
          'inspect',
          'example-plugin',
          '--runtime',
          '--json',
        ],
        ['--profile', paths.profileName, 'plugins', 'doctor'],
      ]);
      assert.match(await readFile(paths.logPath, 'utf8'), /doctor_check_succeeded/);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
