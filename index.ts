import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

import registerDevguardCli from './lib/register-cli.ts';

export default definePluginEntry({
  id: 'openclaw-devguard',
  name: 'OpenClaw DevGuard',
  description: 'Development-time safety guardrails for OpenClaw plugin work.',
  register(api) {
    api.registerCli(
      async ({ program }) => {
        registerDevguardCli(program);
      },
      {
        commands: ['devguard'],
        descriptors: [
          {
            name: 'devguard',
            description: 'Inspect and manage OpenClaw DevGuard development safeguards.',
            hasSubcommands: true,
          },
        ],
      },
    );
  },
});
