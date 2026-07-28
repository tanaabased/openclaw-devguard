import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  extractToolEnvironment,
  redactValue,
  summarizeEnvironment,
} from '../utils/log-redaction.ts';

export interface BeforeToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
  toolKind?: string;
  toolInputKind?: string;
  runId?: string;
  toolCallId?: string;
  derivedPaths?: readonly string[];
}

export interface BeforeToolCallContext {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
  toolName: string;
  toolKind?: string;
  toolInputKind?: string;
  toolCallId?: string;
  channelId?: string;
}

export interface ToolGuardOptions {
  pluginId: string;
  buildId: string;
  logPath: string;
  environment?: NodeJS.ProcessEnv;
  environmentValueAllowlist?: readonly string[];
  now?: () => Date;
  append?: (path: string, records: readonly object[]) => Promise<void>;
  onLogError?: (error: unknown) => void;
}

export interface ToolGuardStatus {
  pluginId: string;
  pluginBuildId: string;
  gatewayProcessId: number;
  policyMode: 'deny';
  denyUnknownTools: true;
  hookRegistered: true;
  hookPriority: number;
  logPath: string;
  environmentValueAllowlist: readonly string[];
}

export const TOOL_GUARD_PRIORITY = 1_000_000;

async function appendJsonl(path: string, records: readonly object[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
}

function classifyEffects(toolName: string): string[] {
  const normalized = toolName.toLowerCase();
  const effects = new Set<string>(['unknown']);

  if (/exec|process|shell|terminal|command/.test(normalized)) effects.add('process');
  if (/write|edit|patch|file|filesystem/.test(normalized)) effects.add('filesystem');
  if (/browser|computer|chrome/.test(normalized)) effects.add('interactive-control');
  if (/network|fetch|http|web|mail|message|slack|github/.test(normalized)) {
    effects.add('external-state');
  }
  if (/cron|gateway|node|config/.test(normalized)) effects.add('administration');
  if (effects.size > 1) effects.delete('unknown');
  return [...effects];
}

export default function createToolGuard(options: ToolGuardOptions): {
  beforeToolCall: (
    event: BeforeToolCallEvent,
    context: BeforeToolCallContext,
  ) => Promise<{ block: true; blockReason: string }>;
  status: () => ToolGuardStatus;
} {
  const environment = options.environment ?? process.env;
  const environmentValueAllowlist = [...(options.environmentValueAllowlist ?? [])];
  const now = options.now ?? (() => new Date());
  const append = options.append ?? appendJsonl;

  return {
    async beforeToolCall(event, context) {
      const timestamp = now().toISOString();
      const runId = event.runId ?? context.runId;
      const toolCallId = event.toolCallId ?? context.toolCallId;
      const toolEnvironment = extractToolEnvironment(event.params);
      const correlation = {
        timestamp,
        runId,
        toolCallId,
        agentId: context.agentId,
        sessionKey: context.sessionKey,
        sessionId: context.sessionId,
        channelId: context.channelId,
        pluginId: options.pluginId,
        pluginBuildId: options.buildId,
        gatewayProcessId: process.pid,
        toolName: event.toolName,
        toolKind: event.toolKind ?? context.toolKind,
        toolInputKind: event.toolInputKind ?? context.toolInputKind,
      };
      const reason = 'DevGuard deny mode blocks all tool calls, including unknown tools.';
      const records = [
        {
          event: 'tool_call_attempted',
          ...correlation,
          params: redactValue(event.params),
          derivedPaths: event.derivedPaths ?? [],
          effects: classifyEffects(event.toolName),
          environment: {
            gatewayProcess: summarizeEnvironment(
              environment as Record<string, unknown>,
              environmentValueAllowlist,
            ),
            toolArguments: summarizeEnvironment(toolEnvironment, environmentValueAllowlist),
            devguardInjectedNames: Object.keys(environment)
              .filter(
                (name) => name.startsWith('DEVGUARD_') || name.startsWith('OPENCLAW_DEVGUARD_'),
              )
              .sort(),
            finalToolProcessEnvironmentComplete: false,
          },
        },
        {
          event: 'tool_call_blocked',
          ...correlation,
          decision: 'blocked',
          reason,
        },
      ];

      let blockReason = reason;
      try {
        await append(options.logPath, records);
      } catch (error) {
        options.onLogError?.(error);
        blockReason = `${reason} Event logging failed; execution remains blocked.`;
      }

      return { block: true, blockReason };
    },
    status() {
      return {
        pluginId: options.pluginId,
        pluginBuildId: options.buildId,
        gatewayProcessId: process.pid,
        policyMode: 'deny',
        denyUnknownTools: true,
        hookRegistered: true,
        hookPriority: TOOL_GUARD_PRIORITY,
        logPath: options.logPath,
        environmentValueAllowlist,
      };
    },
  };
}
