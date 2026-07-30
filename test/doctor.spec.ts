import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import doctorDevguard, { type DoctorDevguardOptions } from '../cli/doctor.ts';
import { createCliStyles } from '../lib/cli-output.ts';
import { type GatewayStatus } from '../lib/gateway-status.ts';
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
  it('should reject an unsupported host before project discovery', async () => {
    const logger: Logger = { info() {}, warn() {}, error() {} };

    await assert.rejects(
      doctorDevguard('/path/that/does/not/exist', { logger, platform: 'win32' }),
      /platform win32 is unsupported/,
    );
  });

  it('should emit human and JSON reports from the same ordered checks', async () => {
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
    const passingStatus: GatewayStatus = {
      ambientChannelsDisabled: true,
      denyUnknownTools: true,
      hookRegistered: true,
      pluginBuildId: 'build-1',
      pluginId: 'example-plugin',
      policyMode: 'probe',
      profileName: paths.profileName,
      stateDirectory: paths.stateDirectory,
    };
    const runCommand: NonNullable<DoctorDevguardOptions['runCommand']> = async (
      command,
      args,
      options,
    ) => {
      assert.equal(command, 'openclaw');
      assert.equal(options?.env?.OPENCLAW_CONFIG_PATH, join(paths.stateDirectory, 'openclaw.json'));
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
    };
    const doctorOptions = (
      outputWrites: string[],
      gatewayStatus: GatewayStatus,
      json = false,
    ): DoctorDevguardOptions => ({
      environment,
      json,
      logger,
      output: { writeStdout: (value) => outputWrites.push(value) },
      queryStatus: async ({ token, url }) => {
        assert.equal(token, 'gateway-secret');
        assert.equal(url, 'ws://127.0.0.1:19001');
        return gatewayStatus;
      },
      runCommand,
      styles: createCliStyles({ NO_COLOR: '' }),
    });

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

      await doctorDevguard(nested, doctorOptions(writes, passingStatus));

      assert.equal(writes.length, 1);
      assert.equal(writes[0]?.split('\n').filter(Boolean).length, 22);
      assert.match(writes[0] ?? '', /^pass\s+initialized state/m);
      assert.match(writes[0] ?? '', /^agents\s+main$/m);
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

      writes.length = 0;
      commands.length = 0;
      await doctorDevguard(nested, doctorOptions(writes, passingStatus, true));

      assert.equal(writes.length, 1);
      assert.match(writes[0] ?? '', /\n$/);
      const passingReport = JSON.parse(writes[0] ?? '') as {
        checks: Array<{ id: string; ok: boolean }>;
        ok: boolean;
      };
      assert.equal(passingReport.ok, true);
      assert.deepEqual(
        passingReport.checks.map(({ id }) => id),
        [
          'initialized',
          'profile-import',
          'agent-state-isolated',
          'profile-isolated',
          'profile-selected',
          'state-config',
          'gateway-config',
          'sandbox-disabled',
          'elevated-disabled',
          'exec-pipeline-open',
          'openai-runtime-compatible',
          'gateway-reachable',
          'profile-active',
          'channels-disabled',
          'guard-active',
          'unknown-tools-denied',
          'target-id',
          'live-target-id',
          'runtime-inspection',
          'plugin-doctor',
          'build-current',
        ],
      );
      assert.deepEqual(
        passingReport.checks.filter(({ ok }) => !ok),
        [],
      );

      writes.length = 0;
      await assert.rejects(
        doctorDevguard(
          nested,
          doctorOptions(writes, { ...passingStatus, hookRegistered: false }, true),
        ),
        /1 DevGuard doctor check failed/,
      );
      const failedReport = JSON.parse(writes[0] ?? '') as {
        checks: Array<{ id: string; ok: boolean }>;
        ok: boolean;
      };
      assert.equal(failedReport.ok, false);
      assert.equal(failedReport.checks.length, passingReport.checks.length);
      assert.deepEqual(
        failedReport.checks.filter(({ ok }) => !ok).map(({ id }) => id),
        ['guard-active'],
      );

      const auditLog = await readFile(paths.logPath, 'utf8');
      assert.match(auditLog, /doctor_check_succeeded/);
      assert.match(auditLog, /doctor_check_failed/);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
