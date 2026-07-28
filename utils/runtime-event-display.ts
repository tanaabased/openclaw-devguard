export interface RuntimeEventDisplay {
  detail?: string;
  label: string;
  target?: string;
}

function compact(value: unknown, maximumLength = 160): string | undefined {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return undefined;
  if (normalized.length <= maximumLength) return normalized;
  return `${normalized.slice(0, maximumLength - 1)}…`;
}

function eventRecord(value: unknown): Record<string, unknown> & { event: string } {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError('event record must be an object');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.event !== 'string' || record.event.length === 0) {
    throw new TypeError('event record must include an event name');
  }
  return record as Record<string, unknown> & { event: string };
}

/** Reduces one JSONL event to the concise fields owned by the human tail renderer. */
export default function runtimeEventDisplay(value: unknown): RuntimeEventDisplay {
  const record = eventRecord(value);
  const params =
    record.params && typeof record.params === 'object' && !Array.isArray(record.params)
      ? (record.params as Record<string, unknown>)
      : undefined;
  const target = compact(record.toolName ?? record.pluginBuildId ?? record.pluginId);
  const detail = [
    compact(record.decision),
    compact(params?.command),
    compact(record.error ?? record.reason),
    record.gatewayProcessId === undefined ? undefined : `pid ${String(record.gatewayProcessId)}`,
  ]
    .filter((entry): entry is string => entry !== undefined)
    .join(' · ');

  return {
    label: record.event.replaceAll('_', ' '),
    ...(target ? { target } : {}),
    ...(detail ? { detail } : {}),
  };
}
