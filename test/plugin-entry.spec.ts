import assert from 'node:assert/strict';

import type { PluginLogger } from 'openclaw/plugin-sdk/plugin-entry';

import plugin from '../index.ts';
import { type CommandLike } from '../lib/register-cli.ts';

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
    let hook:
      { name: string; handler: (...args: never[]) => unknown; priority?: number } | undefined;
    let gatewayMethod: string | undefined;
    const api = {
      id: 'openclaw-devguard',
      version: '0.0.0',
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
        hook = { name, handler, priority: hookOptions?.priority };
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
    assert.equal(hook?.name, 'before_tool_call');
    assert.equal(hook?.priority, 1_000_000);
    assert.equal(gatewayMethod, 'devguard.status');
    assert.deepEqual(infoMessages, ['[devguard] deny policy registered with priority 1000000']);
    assert.deepEqual(debugMessages.slice(0, 1), [
      '[devguard] initializing plugin runtime openclaw-devguard (0.0.0)',
    ]);
    assert.equal(debugMessages.length, 2);
    assert.match(debugMessages[1] ?? '', /^\[devguard\] audit log configured at /);
  });
});
