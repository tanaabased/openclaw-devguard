import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { runBeforeToolCallHook } from 'openclaw/plugin-sdk/agent-harness';
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

export default definePluginEntry({
  id: 'devguard-example',
  name: 'DevGuard example plugin',
  description: 'Deterministic target plugin for DevGuard Leia scenarios.',
  register(api) {
    api.registerGatewayMethod('devguard-example.attempt-tool', async ({ params, respond }) => {
      const toolName = typeof params.toolName === 'string' ? params.toolName : 'unknown';
      const sentinelPath = join(process.env.TMPDIR ?? '.', `${toolName}-sentinel`);
      const outcome = await runBeforeToolCallHook({
        toolName,
        toolCallId: `leia-${toolName}`,
        params: {
          command: `write ${sentinelPath}`,
          env: { DEVGUARD_TEST_SECRET: 'leia-sensitive-value' },
          path: sentinelPath,
        },
        ctx: {
          agentId: 'leia-agent',
          runId: 'leia-run',
          sessionKey: 'agent:leia:main',
        },
      });
      if (!outcome.blocked) await writeFile(sentinelPath, 'guard bypassed\n', 'utf8');
      respond(true, outcome);
    });
  },
});
