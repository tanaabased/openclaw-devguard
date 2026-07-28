import assert from 'node:assert/strict';

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
    let registrar: ((context: { program: CommandLike }) => Promise<void> | void) | undefined;
    let options: { commands?: string[]; descriptors?: Array<{ name: string }> } | undefined;
    const api = {
      registerCli(
        nextRegistrar: (context: { program: CommandLike }) => Promise<void> | void,
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
  });
});
