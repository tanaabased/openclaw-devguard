import assert from 'node:assert/strict';

import doctorChecks, { latestSuccessfulBuildId } from '../utils/doctor-checks.ts';

const stateConfig = {
  gateway: {
    mode: 'local',
    bind: 'loopback',
    auth: { mode: 'token' },
    port: 19_001,
  },
  tools: { exec: { host: 'gateway', mode: 'full' }, elevated: { enabled: false } },
  agents: {
    defaults: {
      model: 'openai/gpt-test',
      models: { 'openai/gpt-test': { agentRuntime: { id: 'openclaw' } } },
      sandbox: { mode: 'off' },
    },
    list: [{ id: 'main', agentDir: '/devguard/state/agents/main/agent' }],
  },
};

describe('utils/doctor-checks', () => {
  it('should accept a fully isolated current probe-mode environment', () => {
    const checks = doctorChecks({
      artifactPermissionsOk: true,
      expectedPluginId: 'example-plugin',
      expectedPolicyMode: 'probe',
      expectedPort: 19_001,
      expectedProfileName: 'devguard-example',
      expectedStateDirectory: '/devguard/state',
      gatewayStatus: {
        ambientChannelsDisabled: true,
        denyUnknownTools: true,
        hookRegistered: true,
        pluginBuildId: 'build-1',
        pluginId: 'example-plugin',
        policyMode: 'probe',
        profileName: 'devguard-example',
        stateDirectory: '/devguard/state',
      },
      importedAgentIds: ['main'],
      initialized: true,
      latestBuildId: 'build-1',
      manifestId: 'example-plugin',
      openClawCompatibilityOk: true,
      pluginDoctorOk: true,
      productionStateDirectory: '/normal/state',
      runtimeInspectionOk: true,
      stateConfig,
    });

    assert.equal(checks.length, 23);
    assert.deepEqual(
      checks.filter(({ ok }) => !ok),
      [],
    );
  });

  it('should reject an imported OpenAI model that bypasses the OpenClaw tool runtime', () => {
    const checks = doctorChecks({
      artifactPermissionsOk: true,
      expectedPluginId: 'example-plugin',
      expectedPolicyMode: 'probe',
      expectedPort: 19_001,
      expectedProfileName: 'devguard-example',
      expectedStateDirectory: '/devguard/state',
      importedAgentIds: ['main'],
      initialized: true,
      openClawCompatibilityOk: true,
      pluginDoctorOk: true,
      productionStateDirectory: '/normal/state',
      runtimeInspectionOk: true,
      stateConfig: {
        ...stateConfig,
        agents: {
          defaults: {
            ...stateConfig.agents.defaults,
            models: { 'openai/gpt-test': { agentRuntime: { id: 'codex' } } },
          },
          list: stateConfig.agents.list,
        },
      },
    });

    assert.deepEqual(
      checks.find(({ id }) => id === 'openai-runtime-compatible'),
      {
        id: 'openai-runtime-compatible',
        label: 'openai tools use openclaw runtime',
        ok: false,
        detail: 'openai/gpt-test',
      },
    );
  });

  it('should report independent safety and runtime failures together', () => {
    const checks = doctorChecks({
      artifactPermissionsDetail: '/tmp/events.jsonl: mode 0644 grants group or other access',
      artifactPermissionsOk: false,
      expectedPluginId: 'example-plugin',
      expectedPolicyMode: 'probe',
      expectedPort: 19_001,
      expectedProfileName: 'devguard-example',
      expectedStateDirectory: '/normal/state',
      gatewayError: 'connection refused',
      initialized: false,
      manifestId: 'wrong-plugin',
      openClawCompatibilityOk: false,
      pluginDoctorOk: false,
      productionStateDirectory: '/normal/state',
      runtimeInspectionOk: false,
      stateConfig: {},
    });

    const failed = new Set(checks.filter(({ ok }) => !ok).map(({ id }) => id));
    assert.ok(failed.has('initialized'));
    assert.ok(failed.has('artifact-permissions'));
    assert.ok(failed.has('profile-import'));
    assert.ok(failed.has('agent-state-isolated'));
    assert.ok(failed.has('profile-isolated'));
    assert.ok(failed.has('profile-selected'));
    assert.ok(failed.has('sandbox-disabled'));
    assert.ok(failed.has('exec-pipeline-open'));
    assert.ok(failed.has('openclaw-compatible'));
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
