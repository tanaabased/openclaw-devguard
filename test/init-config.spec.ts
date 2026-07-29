import assert from 'node:assert/strict';

import { createIsolatedStatePatch } from '../cli/init.ts';

describe('cli/init configuration', () => {
  it('should preserve imported model and agents while enforcing devguard safety invariants', () => {
    const patch = createIsolatedStatePatch(
      19_001,
      'gateway-token',
      {
        agents: {
          defaults: {
            model: 'openai/model-test',
            sandbox: { mode: 'off', workspaceAccess: 'rw' },
          },
          list: [
            {
              id: 'main',
              default: true,
              workspace: '/workspace',
              tools: { allow: ['exec'] },
            },
            { id: 'devbot', workspace: '/workspace-devbot' },
          ],
        },
        tools: { exec: { mode: 'deny' }, elevated: { enabled: true } },
      },
      Buffer.from('avatar'),
    ) as {
      agents: {
        defaults: { model: string; sandbox: { mode: string } };
        list: Array<{ default?: boolean; id: string }>;
      };
      gateway: { auth: { token: string }; bind: string; mode: string; port: number };
      tools: { elevated: { enabled: boolean }; exec: { host: string; mode: string } };
      ui: { assistant: { avatar: string; name: string } };
    };

    assert.equal(patch.agents.defaults.model, 'openai/model-test');
    assert.deepEqual(patch.agents.defaults.sandbox, { mode: 'off' });
    assert.deepEqual(
      patch.agents.list.map(({ default: isDefault, id }) => ({ id, default: isDefault })),
      [
        { id: 'main', default: true },
        { id: 'devbot', default: undefined },
      ],
    );
    assert.deepEqual(patch.tools, {
      exec: { host: 'gateway', mode: 'full' },
      elevated: { enabled: false },
    });
    assert.deepEqual(patch.gateway, {
      mode: 'local',
      bind: 'loopback',
      auth: { mode: 'token', token: 'gateway-token' },
      port: 19_001,
    });
    assert.deepEqual(patch.ui, {
      assistant: {
        name: 'DEVGUARD',
        avatar: 'data:image/png;base64,YXZhdGFy',
      },
    });
  });
});
