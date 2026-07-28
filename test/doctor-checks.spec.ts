import assert from 'node:assert/strict';

import doctorChecks, { latestSuccessfulBuildId } from '../utils/doctor-checks.ts';

const stateConfig = {
  gateway: {
    mode: 'local',
    bind: 'loopback',
    auth: { mode: 'token' },
    port: 19_001,
  },
  tools: { exec: { mode: 'deny' }, elevated: { enabled: false } },
  agents: { defaults: { sandbox: { mode: 'all', workspaceAccess: 'none' } } },
};

describe('utils/doctor-checks', () => {
  it('should accept a fully isolated current deny-mode environment', () => {
    const checks = doctorChecks({
      expectedPluginId: 'example-plugin',
      expectedPort: 19_001,
      expectedStateDirectory: '/devguard/state',
      gatewayStatus: {
        ambientChannelsDisabled: true,
        denyUnknownTools: true,
        hookRegistered: true,
        pluginBuildId: 'build-1',
        pluginId: 'example-plugin',
        policyMode: 'deny',
        stateDirectory: '/devguard/state',
      },
      initialized: true,
      latestBuildId: 'build-1',
      manifestId: 'example-plugin',
      pluginDoctorOk: true,
      productionStateDirectory: '/normal/state',
      runtimeInspectionOk: true,
      stateConfig,
    });

    assert.equal(checks.length, 18);
    assert.deepEqual(
      checks.filter(({ ok }) => !ok),
      [],
    );
  });

  it('should report independent safety and runtime failures together', () => {
    const checks = doctorChecks({
      expectedPluginId: 'example-plugin',
      expectedPort: 19_001,
      expectedStateDirectory: '/normal/state',
      gatewayError: 'connection refused',
      initialized: false,
      manifestId: 'wrong-plugin',
      pluginDoctorOk: false,
      productionStateDirectory: '/normal/state',
      runtimeInspectionOk: false,
      stateConfig: {},
    });

    const failed = new Set(checks.filter(({ ok }) => !ok).map(({ id }) => id));
    assert.ok(failed.has('initialized'));
    assert.ok(failed.has('profile-isolated'));
    assert.ok(failed.has('gateway-reachable'));
    assert.ok(failed.has('guard-active'));
    assert.ok(failed.has('target-id'));
    assert.ok(failed.has('runtime-inspection'));
    assert.ok(failed.has('plugin-doctor'));
    assert.ok(failed.has('build-current'));
  });

  it('should find the latest successful build through malformed records', () => {
    const contents = [
      JSON.stringify({ event: 'build_succeeded', pluginBuildId: 'build-1' }),
      'not-json',
      JSON.stringify({ event: 'build_failed' }),
      JSON.stringify({ event: 'build_succeeded', pluginBuildId: 'build-2' }),
      '',
    ].join('\n');

    assert.equal(latestSuccessfulBuildId(contents), 'build-2');
  });
});
