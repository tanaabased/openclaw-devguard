import { randomUUID } from 'node:crypto';

import {
  buildExecProbeCommand,
  parseExecProbeResult,
  type ExecProbeResult,
} from '../utils/exec-probe.ts';
import {
  extractToolEnvironment,
  redactValue,
  summarizeEnvironment,
} from '../utils/log-redaction.ts';
import { appendPrivateFile } from '../utils/private-artifact.ts';

export type ToolPolicyMode = 'deny' | 'probe';

export interface BeforeToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
  toolKind?: string;
  toolInputKind?: string;
  runId?: string;
  toolCallId?: string;
  derivedPaths?: readonly string[];
}

export interface AfterToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
  runId?: string;
  toolCallId?: string;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

export interface ToolCallContext {
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
  policyMode?: ToolPolicyMode;
  probeExecutablePath?: string;
  probeScriptPath?: string;
  environment?: NodeJS.ProcessEnv;
  environmentValueAllowlist?: readonly string[];
  createProbeId?: () => string;
  now?: () => Date;
  append?: (path: string, records: readonly object[]) => Promise<void>;
  onLogError?: (error: unknown) => void;
}

export interface ToolGuardStatus {
  ambientChannelsDisabled: boolean;
  pluginId: string;
  pluginBuildId: string;
  gatewayProcessId: number;
  policyMode: ToolPolicyMode;
  profileName?: string;
  denyUnknownTools: true;
  hookRegistered: true;
  hookPriority: number;
  logPath: string;
  environmentValueAllowlist: readonly string[];
  stateDirectory?: string;
}

export const TOOL_CAPTURE_PRIORITY = 1_000_000;
export const TOOL_GUARD_PRIORITY = -1_000_000;

const PROBE_SYSTEM_CONTEXT =
  'DevGuard probe mode replaces supported tool execution with a non-mutating recorder. An exec result describes only the probe environment: the originally requested command was not executed, its side effects did not occur, and it should not be retried unless the user explicitly asks.';

async function appendJsonl(path: string, records: readonly object[]): Promise<void> {
  await appendPrivateFile(path, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
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

function callKey(
  event: { runId?: string; toolCallId?: string; toolName: string },
  context: ToolCallContext,
): string | undefined {
  const toolCallId = event.toolCallId ?? context.toolCallId;
  if (toolCallId) return `call:${toolCallId}`;
  const runId = event.runId ?? context.runId;
  return runId ? `run:${runId}:${event.toolName}` : undefined;
}

export default function createToolGuard(options: ToolGuardOptions): {
  captureToolCall: (
    event: BeforeToolCallEvent,
    context: ToolCallContext,
  ) => Promise<{ block: true; blockReason: string } | void>;
  applyToolPolicy: (
    event: BeforeToolCallEvent,
    context: ToolCallContext,
  ) => Promise<{ block: true; blockReason: string } | { params: Record<string, unknown> }>;
  recordToolResult: (event: AfterToolCallEvent, context: ToolCallContext) => Promise<void>;
  buildPromptContext: () => { appendSystemContext: string } | undefined;
  status: () => ToolGuardStatus;
} {
  const environment = options.environment ?? process.env;
  const environmentValueAllowlist = [...new Set(options.environmentValueAllowlist ?? [])].sort();
  const policyMode = options.policyMode ?? 'probe';
  const now = options.now ?? (() => new Date());
  const append = options.append ?? appendJsonl;
  const createProbeId = options.createProbeId ?? randomUUID;
  const pendingProbes = new Map<string, string>();

  if (policyMode === 'probe' && (!options.probeExecutablePath || !options.probeScriptPath)) {
    throw new Error('probe mode requires executable and recorder script paths');
  }

  function correlation(
    event: {
      toolName: string;
      toolKind?: string;
      toolInputKind?: string;
      runId?: string;
      toolCallId?: string;
    },
    context: ToolCallContext,
  ) {
    return {
      timestamp: now().toISOString(),
      runId: event.runId ?? context.runId,
      toolCallId: event.toolCallId ?? context.toolCallId,
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
  }

  async function blocked(
    event: BeforeToolCallEvent,
    context: ToolCallContext,
    reason: string,
  ): Promise<{ block: true; blockReason: string }> {
    let blockReason = reason;
    try {
      await append(options.logPath, [
        {
          event: 'tool_call_blocked',
          ...correlation(event, context),
          decision: 'blocked',
          reason,
        },
      ]);
    } catch (error) {
      options.onLogError?.(error);
      blockReason = `${reason} Event logging failed; execution remains blocked.`;
    }
    return { block: true, blockReason };
  }

  async function recordProbeOutcome(
    event: AfterToolCallEvent,
    context: ToolCallContext,
    result: ExecProbeResult | undefined,
    expectedProbeId: string | undefined,
  ): Promise<void> {
    const completed = result && (!expectedProbeId || result.probeId === expectedProbeId);
    const record = completed
      ? {
          event: 'tool_call_probe_completed',
          ...correlation(event, context),
          decision: 'probed',
          durationMs: event.durationMs,
          probeId: result.probeId,
          originalCommandExecuted: result.originalCommandExecuted,
          environment: result.environment,
        }
      : {
          event: 'tool_call_probe_failed',
          ...correlation(event, context),
          decision: 'blocked',
          durationMs: event.durationMs,
          probeId: expectedProbeId,
          originalCommandExecuted: false,
          reason:
            event.error ??
            (result
              ? 'exec probe returned an unexpected probe id'
              : 'exec probe result was missing'),
        };
    try {
      await append(options.logPath, [record]);
    } catch (error) {
      options.onLogError?.(error);
    }
  }

  return {
    async captureToolCall(event, context) {
      const toolEnvironment = extractToolEnvironment(event.params);
      try {
        await append(options.logPath, [
          {
            event: 'tool_call_attempted',
            ...correlation(event, context),
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
        ]);
      } catch (error) {
        options.onLogError?.(error);
        return {
          block: true,
          blockReason: 'DevGuard audit logging failed; execution remains blocked.',
        };
      }
    },
    async applyToolPolicy(event, context) {
      if (policyMode !== 'probe' || event.toolName.toLowerCase() !== 'exec') {
        const reason =
          policyMode === 'deny'
            ? 'DevGuard deny mode blocks all tool calls, including unknown tools.'
            : 'DevGuard probe mode blocks tools without a non-mutating probe.';
        return blocked(event, context, reason);
      }

      const probeId = createProbeId();
      const command = buildExecProbeCommand({
        environmentNames: environmentValueAllowlist,
        executablePath: options.probeExecutablePath!,
        probeId,
        scriptPath: options.probeScriptPath!,
      });
      try {
        await append(options.logPath, [
          {
            event: 'tool_call_probed',
            ...correlation(event, context),
            decision: 'probe',
            probeId,
            originalCommandExecuted: false,
            environmentNames: environmentValueAllowlist,
          },
        ]);
      } catch (error) {
        options.onLogError?.(error);
        return {
          block: true,
          blockReason: 'DevGuard probe audit logging failed; execution remains blocked.',
        };
      }
      const key = callKey(event, context);
      if (key) pendingProbes.set(key, probeId);

      return {
        params: {
          command,
          host: 'gateway',
          env: {},
          background: false,
          elevated: false,
          pty: false,
          ask: 'off',
          timeout: 15,
          yieldMs: 15_000,
        },
      };
    },
    async recordToolResult(event, context) {
      if (policyMode !== 'probe' || event.toolName.toLowerCase() !== 'exec') return;
      const key = callKey(event, context);
      const expectedProbeId = key ? pendingProbes.get(key) : undefined;
      if (key) pendingProbes.delete(key);
      const result = parseExecProbeResult(event.result);
      if (!result && !expectedProbeId) return;
      await recordProbeOutcome(event, context, result, expectedProbeId);
    },
    buildPromptContext() {
      return policyMode === 'probe' ? { appendSystemContext: PROBE_SYSTEM_CONTEXT } : undefined;
    },
    status() {
      return {
        ambientChannelsDisabled: environment.OPENCLAW_SKIP_CHANNELS === '1',
        pluginId: options.pluginId,
        pluginBuildId: options.buildId,
        gatewayProcessId: process.pid,
        policyMode,
        ...(environment.OPENCLAW_PROFILE ? { profileName: environment.OPENCLAW_PROFILE } : {}),
        denyUnknownTools: true,
        hookRegistered: true,
        hookPriority: TOOL_GUARD_PRIORITY,
        logPath: options.logPath,
        environmentValueAllowlist,
        ...(environment.OPENCLAW_STATE_DIR
          ? { stateDirectory: environment.OPENCLAW_STATE_DIR }
          : {}),
      };
    },
  };
}
