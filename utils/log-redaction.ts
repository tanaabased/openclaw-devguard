export const REDACTED_VALUE = '[redacted]';

const SENSITIVE_NAME_PATTERN =
  /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASSWD|AUTH|COOKIE|SESSION|PRIVATE|CREDENTIAL|API_KEY|KEY)(?:_|$)/i;
const ENVIRONMENT_FIELD_NAMES = new Set(['env', 'environment']);

export interface EnvironmentVariableSummary {
  name: string;
  present: true;
  length?: number;
  preview?: string;
  redacted?: true;
}

function normalizedName(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^a-zA-Z0-9]+/g, '_');
}

export function isSensitiveName(name: string): boolean {
  return SENSITIVE_NAME_PATTERN.test(normalizedName(name));
}

export function maskedPreview(value: string): string {
  if (value.length === 0) return '';
  if (value.length === 1) return '…';
  if (value.length <= 4) return `${value.slice(0, 1)}…${value.slice(-1)}`;
  return `${value.slice(0, 2)}…${value.slice(-2)}`;
}

export function summarizeEnvironment(
  environment: Record<string, unknown>,
  previewAllowlist: readonly string[] = [],
): EnvironmentVariableSummary[] {
  const allowlist = new Set(previewAllowlist);

  return Object.entries(environment)
    .filter((entry): entry is [string, Exclude<unknown, undefined>] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, rawValue]) => {
      let value: string;
      try {
        value = typeof rawValue === 'string' ? rawValue : String(rawValue);
      } catch {
        return { name, present: true, redacted: true };
      }
      const summary: EnvironmentVariableSummary = {
        name,
        present: true,
        length: value.length,
      };

      if (isSensitiveName(name)) {
        summary.redacted = true;
      } else if (allowlist.has(name)) {
        summary.preview = maskedPreview(value);
      }

      return summary;
    });
}

function redactValueInternal(
  value: unknown,
  key: string | undefined,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (key && isSensitiveName(key)) return REDACTED_VALUE;
  if (key && ENVIRONMENT_FIELD_NAMES.has(key.toLowerCase())) return '[captured separately]';
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined') return '[undefined]';
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`;
  if (depth >= 8) return '[maximum depth reached]';
  if (seen.has(value)) return '[circular]';

  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => redactValueInternal(entry, undefined, depth + 1, seen));
  }

  const redacted: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    redacted[childKey] = redactValueInternal(childValue, childKey, depth + 1, seen);
  }
  return redacted;
}

export function redactValue(value: unknown): unknown {
  return redactValueInternal(value, undefined, 0, new WeakSet());
}

export function extractToolEnvironment(params: Record<string, unknown>): Record<string, unknown> {
  const found: Record<string, unknown> = {};
  const seen = new WeakSet<object>();

  const visit = (value: unknown, depth: number): void => {
    if (value === null || typeof value !== 'object' || depth >= 8 || seen.has(value)) return;
    seen.add(value);

    for (const [key, child] of Object.entries(value)) {
      if (ENVIRONMENT_FIELD_NAMES.has(key.toLowerCase()) && child && typeof child === 'object') {
        for (const [environmentName, environmentValue] of Object.entries(child)) {
          found[environmentName] = environmentValue;
        }
        continue;
      }
      visit(child, depth + 1);
    }
  };

  visit(params, 0);
  return found;
}
