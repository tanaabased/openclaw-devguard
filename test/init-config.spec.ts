import assert from 'node:assert/strict';

import { createIsolatedStatePatch } from '../cli/init.ts';

describe('cli/init configuration', () => {
  it('should preserve imported model and agents while enforcing devguard safety invariants', () => {
    const patch = createIsolatedStatePatch(19_001, 'gateway-token', {
      agents: {
        defaults: {
          model: 'openai/model-test',
          sandbox: { mode: 'off', workspaceAccess: 'rw' },
        },
        list: [{ id: 'main', workspace: '/workspace', tools: { allow: ['exec'] } }],
      },
      tools: { exec: { mode: 'deny' }, elevated: { enabled: true } },
    }) as {
      agents: {
        defaults: { model: string; sandbox: { mode: string } };
        list: unknown[];
      };
      gateway: { auth: { token: string }; bind: string; mode: string; port: number };
      tools: { elevated: { enabled: boolean }; exec: { mode: string } };
    };

    assert.equal(patch.agents.defaults.model, 'openai/model-test');
    assert.deepEqual(patch.agents.defaults.sandbox, { mode: 'off' });
    assert.equal(patch.agents.list.length, 1);
    assert.deepEqual(patch.tools, {
      exec: { mode: 'full' },
      elevated: { enabled: false },
    });
    assert.deepEqual(patch.gateway, {
      mode: 'local',
      bind: 'loopback',
      auth: { mode: 'token', token: 'gateway-token' },
      port: 19_001,
    });
  });
});
