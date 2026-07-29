import { createHash } from 'node:crypto';

import { isSensitiveName, maskedPreview } from './log-redaction.ts';

export const EXEC_PROBE_RESULT_PREFIX = 'DEVGUARD_EXEC_PROBE_RESULT ';

const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ExecProbeEnvironmentSummary {
  name: string;
  present: boolean;
  length?: number;
  preview?: string;
  redacted?: true;
  sha256?: string;
}

export interface ExecProbeResult {
  version: 1;
  probeId: string;
  originalCommandExecuted: false;
  environment: ExecProbeEnvironmentSummary[];
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function buildExecProbeCommand(options: {
  environmentNames: readonly string[];
  executablePath: string;
  probeId: string;
  scriptPath: string;
}): string {
  const arguments_ = [
    options.executablePath,
    options.scriptPath,
    options.probeId,
    ...options.environmentNames,
  ];
  return arguments_.map(shellQuote).join(' ');
}

export function createExecProbeResult(
  probeId: string,
  environmentNames: readonly string[],
  environment: NodeJS.ProcessEnv,
): ExecProbeResult {
  if (probeId.length === 0) throw new Error('exec probe id must not be empty');
  if (environmentNames.some((name) => !ENVIRONMENT_NAME_PATTERN.test(name))) {
    throw new Error('exec probe environment names must be portable variable names');
  }

  return {
    version: 1,
    probeId,
    originalCommandExecuted: false,
    environment: [...new Set(environmentNames)].sort().map((name) => {
      const value = environment[name];
      if (value === undefined) return { name, present: false };
      if (isSensitiveName(name)) {
        return { name, present: true, length: value.length, redacted: true };
      }
      return {
        name,
        present: true,
        length: value.length,
        preview: maskedPreview(value),
        sha256: createHash('sha256').update(value).digest('hex'),
      };
    }),
  };
}

function stringValues(value: unknown, depth = 0, seen = new WeakSet<object>()): string[] {
  if (typeof value === 'string') return [value];
  if (value === null || typeof value !== 'object' || depth >= 8 || seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) {
    return value.flatMap((entry) => stringValues(entry, depth + 1, seen));
  }
  return Object.values(value).flatMap((entry) => stringValues(entry, depth + 1, seen));
}

function validProbeResult(value: unknown): value is ExecProbeResult {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  const result = value as Partial<ExecProbeResult>;
  return (
    result.version === 1 &&
    typeof result.probeId === 'string' &&
    result.probeId.length > 0 &&
    result.originalCommandExecuted === false &&
    Array.isArray(result.environment)
  );
}

export function parseExecProbeResult(value: unknown): ExecProbeResult | undefined {
  for (const text of stringValues(value)) {
    const markerIndex = text.indexOf(EXEC_PROBE_RESULT_PREFIX);
    if (markerIndex < 0) continue;
    const line = text.slice(markerIndex + EXEC_PROBE_RESULT_PREFIX.length).split(/\r?\n/, 1)[0];
    if (!line) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (validProbeResult(parsed)) return parsed;
    } catch {
      continue;
    }
  }
  return undefined;
}
