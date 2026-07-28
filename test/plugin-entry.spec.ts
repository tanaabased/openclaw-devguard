import assert from 'node:assert/strict';

import type { PluginLogger } from 'openclaw/plugin-sdk/plugin-entry';

import plugin from '../index.ts';
import { type CommandLike } from '../lib/register-cli.ts';
import { TOOL_CAPTURE_PRIORITY, TOOL_GUARD_PRIORITY } from '../lib/tool-guard.ts';

describe('index', () => {
  it('should expose the official plugin entry contract', () => {
    assert.equal(plugin.id, 'openclaw-devguard');
    assert.equal(plugin.name, 'OpenClaw DevGuard');
    assert.equal(typeof plugin.register, 'function');
    assert.equal(plugin.configSchema.jsonSchema?.additionalProperties, false);
  });

  it('should register the devguard CLI lazily', async () => {
    const debugMessages: string[] = [];
    const infoMessages: string[] = [];
    let registrar:
      | ((context: { logger: PluginLogger; program: CommandLike }) => Promise<void> | void)
      | undefined;
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
      registrationMode: 'full',
      logger: {
        debug: (message: string) => debugMessages.push(message),
        info: (message: string) => infoMessages.push(message),
        warn() {},
        error() {},
      },
      on(
        name: string,
        handler: (...args: never[]) => unknown,
        hookOptions?: { priority?: number },
      ) {
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

    plugin.register(api as never);

    assert.deepEqual(options?.commands, ['devguard']);
    assert.equal(options?.descriptors?.[0]?.name, 'devguard');
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
