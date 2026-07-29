import assert from 'node:assert/strict';

import type { PluginLogger } from 'openclaw/plugin-sdk/plugin-entry';

import plugin from '../index.ts';
import { DEVGUARD_MANAGED_RUNTIME_ENV } from '../lib/dev-runner.ts';
import { type CommandLike } from '../lib/register-cli.ts';
import { TOOL_CAPTURE_PRIORITY, TOOL_GUARD_PRIORITY } from '../lib/tool-guard.ts';

function registerPlugin(managedRuntime: boolean, registrationMode: 'discovery' | 'full' = 'full') {
  const debugMessages: string[] = [];
  const infoMessages: string[] = [];
  let registrar:
    ((context: { logger: PluginLogger; program: CommandLike }) => Promise<void> | void) | undefined;
  let options: { commands?: string[]; descriptors?: Array<{ name: string }> } | undefined;
  const hooks: Array<{
    name: string;
    handler: (...args: never[]) => unknown;
    priority?: number;
  }> = [];
  let gatewayMethod: string | undefined;
  const api = {
    id: 'openclaw-devguard',
    version: 'test-build',
    rootDir: process.cwd(),
    registrationMode,
    logger: {
      debug: (message: string) => debugMessages.push(message),
      info: (message: string) => infoMessages.push(message),
      warn() {},
      error() {},
    },
    on(name: string, handler: (...args: never[]) => unknown, hookOptions?: { priority?: number }) {
      hooks.push({ name, handler, priority: hookOptions?.priority });
    },
    registerGatewayMethod(name: string) {
      gatewayMethod = name;
    },
    registerCli(
      nextRegistrar: (context: {
        logger: PluginLogger;
        program: CommandLike;
      }) => Promise<void> | void,
      nextOptions: { commands?: string[]; descriptors?: Array<{ name: string }> },
    ) {
      registrar = nextRegistrar;
      options = nextOptions;
    },
  };
  const previousManagedRuntime = process.env[DEVGUARD_MANAGED_RUNTIME_ENV];

  try {
    if (managedRuntime) process.env[DEVGUARD_MANAGED_RUNTIME_ENV] = '1';
    else delete process.env[DEVGUARD_MANAGED_RUNTIME_ENV];
    plugin.register(api as never);
  } finally {
    if (previousManagedRuntime === undefined) delete process.env[DEVGUARD_MANAGED_RUNTIME_ENV];
    else process.env[DEVGUARD_MANAGED_RUNTIME_ENV] = previousManagedRuntime;
  }

  return { api, debugMessages, gatewayMethod, hooks, infoMessages, options, registrar };
}

describe('index', () => {
  it('should expose the official plugin entry contract', () => {
    assert.equal(plugin.id, 'openclaw-devguard');
    assert.equal(plugin.name, 'OpenClaw DevGuard');
    assert.equal(typeof plugin.register, 'function');
    assert.equal(plugin.configSchema.jsonSchema?.additionalProperties, false);
    assert.deepEqual(plugin.configSchema.jsonSchema?.properties, {});
  });

  it('should register the devguard CLI without activating policy in a normal Gateway', () => {
    const { debugMessages, gatewayMethod, hooks, infoMessages, options, registrar } =
      registerPlugin(false);

    assert.deepEqual(options?.commands, ['devguard']);
    assert.equal(options?.descriptors?.[0]?.name, 'devguard');
    assert.equal(typeof registrar, 'function');
    assert.deepEqual(hooks, []);
    assert.equal(gatewayMethod, undefined);
    assert.deepEqual(infoMessages, []);
    assert.deepEqual(debugMessages, []);
  });

  it('should not activate policy outside a full Gateway load', () => {
    const { gatewayMethod, hooks, options, registrar } = registerPlugin(true, 'discovery');

    assert.deepEqual(options?.commands, ['devguard']);
    assert.equal(typeof registrar, 'function');
    assert.deepEqual(hooks, []);
    assert.equal(gatewayMethod, undefined);
  });

  it('should activate ordered policy hooks only in a managed Gateway', () => {
    const { api, debugMessages, gatewayMethod, hooks, infoMessages, options, registrar } =
      registerPlugin(true);

    assert.deepEqual(options?.commands, ['devguard']);
    assert.equal(typeof registrar, 'function');
    assert.deepEqual(
      hooks.map(({ name, priority }) => ({ name, priority })),
      [
        { name: 'before_tool_call', priority: TOOL_CAPTURE_PRIORITY },
        { name: 'before_tool_call', priority: TOOL_GUARD_PRIORITY },
      ],
    );
    const targetPluginDefaultPriority = 0;
    assert.ok(TOOL_CAPTURE_PRIORITY > targetPluginDefaultPriority);
    assert.ok(targetPluginDefaultPriority > TOOL_GUARD_PRIORITY);
    assert.equal(gatewayMethod, 'devguard.status');
    assert.ok(infoMessages.some((message) => message.includes(String(TOOL_CAPTURE_PRIORITY))));
    assert.ok(infoMessages.some((message) => message.includes(String(TOOL_GUARD_PRIORITY))));
    assert.ok(
      debugMessages.some((message) => message.includes(api.id) && message.includes(api.version)),
    );
  });
});
