import { homedir } from 'node:os';
import { join } from 'node:path';

import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

import { DEVGUARD_MANAGED_RUNTIME_ENV } from './lib/dev-runner.ts';
import { logDebug, logInfo, reportError } from './lib/logger.ts';
import createToolGuard, { TOOL_CAPTURE_PRIORITY, TOOL_GUARD_PRIORITY } from './lib/tool-guard.ts';
import registerDevguardCli from './lib/register-cli.ts';

function runtimeSettings(): {
  logPath: string;
  environmentValueAllowlist: string[];
} {
  const stateDirectory =
    process.env.OPENCLAW_STATE_DIR ?? join(homedir(), '.openclaw-dev', 'devguard');
  const environmentAllowlist = (process.env.DEVGUARD_ENV_PREVIEW_ALLOWLIST ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  return {
    logPath:
      process.env.DEVGUARD_LOG_PATH ?? join(stateDirectory, 'devguard', 'logs', 'events.jsonl'),
    environmentValueAllowlist: [...new Set(environmentAllowlist)],
  };
}

export default definePluginEntry({
  id: 'openclaw-devguard',
  name: 'OpenClaw DevGuard',
  description: 'Development-time safety guardrails for OpenClaw plugin work.',
  register(api) {
    api.registerCli(
      ({ logger, program }) => {
        registerDevguardCli(program, { logger, pluginRoot: api.rootDir });
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

    if (api.registrationMode !== 'full' || process.env[DEVGUARD_MANAGED_RUNTIME_ENV] !== '1') {
      return;
    }

    const settings = runtimeSettings();
    const buildId = process.env.DEVGUARD_BUILD_ID ?? api.version ?? 'development';
    const targetPluginId = process.env.DEVGUARD_TARGET_PLUGIN_ID ?? api.id;
    logDebug(api.logger, `initializing plugin runtime ${api.id} (${buildId})`);
    const guard = createToolGuard({
      pluginId: targetPluginId,
      buildId,
      logPath: settings.logPath,
      environmentValueAllowlist: settings.environmentValueAllowlist,
      onLogError(error) {
        reportError(api.logger, 'failed to append the tool-call audit log', error);
      },
    });

    api.on('before_tool_call', guard.captureToolCall, { priority: TOOL_CAPTURE_PRIORITY });
    api.on('before_tool_call', guard.blockToolCall, { priority: TOOL_GUARD_PRIORITY });
    logInfo(
      api.logger,
      `tool capture and deny policy registered with priorities ${TOOL_CAPTURE_PRIORITY}/${TOOL_GUARD_PRIORITY}`,
    );
    logDebug(api.logger, `audit log configured at ${settings.logPath}`);
    api.registerGatewayMethod('devguard.status', ({ respond }) => {
      respond(true, guard.status());
    });
  },
});
