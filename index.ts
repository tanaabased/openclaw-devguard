import { homedir } from 'node:os';
import { join } from 'node:path';

import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

import { logDebug, logInfo, reportError } from './lib/logger.ts';
import createToolGuard, { TOOL_GUARD_PRIORITY } from './lib/tool-guard.ts';
import registerDevguardCli from './lib/register-cli.ts';

interface DevguardPluginConfig {
  logging?: {
    logPath?: string;
    environmentValueAllowlist?: string[];
  };
}

function runtimeSettings(pluginConfig: Record<string, unknown> | undefined): {
  logPath: string;
  environmentValueAllowlist: string[];
} {
  const config = (pluginConfig ?? {}) as DevguardPluginConfig;
  const stateDirectory =
    process.env.OPENCLAW_STATE_DIR ?? join(homedir(), '.openclaw-dev', 'devguard');
  const configuredAllowlist = config.logging?.environmentValueAllowlist ?? [];
  const environmentAllowlist = (process.env.DEVGUARD_ENV_PREVIEW_ALLOWLIST ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  return {
    logPath:
      process.env.DEVGUARD_LOG_PATH ??
      config.logging?.logPath ??
      join(stateDirectory, 'devguard', 'logs', 'events.jsonl'),
    environmentValueAllowlist: [...new Set([...configuredAllowlist, ...environmentAllowlist])],
  };
}

export default definePluginEntry({
  id: 'openclaw-devguard',
  name: 'OpenClaw DevGuard',
  description: 'Development-time safety guardrails for OpenClaw plugin work.',
  register(api) {
    const settings = runtimeSettings(api.pluginConfig);
    const buildId = process.env.DEVGUARD_BUILD_ID ?? api.version ?? 'development';
    if (api.registrationMode === 'full') {
      logDebug(api.logger, `initializing plugin runtime ${api.id} (${buildId})`);
    }
    const guard = createToolGuard({
      pluginId: api.id,
      buildId,
      logPath: settings.logPath,
      environmentValueAllowlist: settings.environmentValueAllowlist,
      onLogError(error) {
        reportError(api.logger, 'failed to append the tool-call audit log', error);
      },
    });

    api.on('before_tool_call', guard.beforeToolCall, { priority: TOOL_GUARD_PRIORITY });
    if (api.registrationMode === 'full') {
      logInfo(api.logger, `deny policy registered with priority ${TOOL_GUARD_PRIORITY}`);
      logDebug(api.logger, `audit log configured at ${settings.logPath}`);
    }
    api.registerGatewayMethod('devguard.status', ({ respond }) => {
      respond(true, guard.status());
    });
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
  },
});
