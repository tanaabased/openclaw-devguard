export interface PluginCompatibilityNotice {
  message: string;
  severity: 'info' | 'warn';
}

export interface PluginRuntimeInspection {
  cliCommands: readonly string[];
  compatibility: readonly PluginCompatibilityNotice[];
  gatewayMethods: readonly string[];
  pluginId: string;
  typedHooks: readonly string[];
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return undefined;
  return value as Record<string, unknown>;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`OpenClaw runtime inspection field ${field} has an unexpected value`);
  }
  return value;
}

/**
 * Validates the public JSON contract returned by `openclaw plugins inspect --runtime --json`.
 *
 * @throws {TypeError} When the inspection contract is malformed or describes another plugin.
 * @throws {Error} When OpenClaw reports that the expected plugin is not loaded.
 */
export default function parsePluginRuntimeInspection(
  value: unknown,
  expectedPluginId: string,
): PluginRuntimeInspection {
  const inspection = recordValue(value);
  const plugin = recordValue(inspection?.plugin);
  if (!inspection || !plugin) {
    throw new TypeError('OpenClaw returned an invalid plugin runtime inspection payload');
  }
  if (plugin.id !== expectedPluginId) {
    throw new TypeError(
      `OpenClaw runtime inspection returned ${String(plugin.id)} instead of ${expectedPluginId}`,
    );
  }

  const status = plugin.status;
  if (status !== 'loaded' && status !== 'disabled' && status !== 'error') {
    throw new TypeError('OpenClaw runtime inspection field plugin.status has an unexpected value');
  }
  if (status !== 'loaded') {
    const reason = typeof plugin.error === 'string' ? `: ${plugin.error}` : '';
    throw new Error(`OpenClaw reports plugin ${expectedPluginId} as ${status}${reason}`);
  }

  const typedHooks = Array.isArray(inspection.typedHooks)
    ? inspection.typedHooks.map((entry) => recordValue(entry)?.name)
    : undefined;
  if (!typedHooks || typedHooks.some((name) => typeof name !== 'string')) {
    throw new TypeError('OpenClaw runtime inspection field typedHooks has an unexpected value');
  }

  const compatibility = Array.isArray(inspection.compatibility)
    ? inspection.compatibility.map((entry): PluginCompatibilityNotice => {
        const notice = recordValue(entry);
        const severity = notice?.severity;
        if (
          !notice ||
          (severity !== 'info' && severity !== 'warn') ||
          typeof notice.message !== 'string'
        ) {
          throw new TypeError(
            'OpenClaw runtime inspection field compatibility has an unexpected value',
          );
        }
        return { message: notice.message, severity };
      })
    : undefined;
  if (!compatibility) {
    throw new TypeError('OpenClaw runtime inspection field compatibility has an unexpected value');
  }

  return {
    cliCommands: stringArray(inspection.cliCommands, 'cliCommands'),
    compatibility,
    gatewayMethods: stringArray(inspection.gatewayMethods, 'gatewayMethods'),
    pluginId: expectedPluginId,
    typedHooks: typedHooks as string[],
  };
}
