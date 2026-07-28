import assert from 'node:assert/strict';

import registerDevguardCli, { type CommandLike } from '../lib/register-cli.ts';

class FakeCommand implements CommandLike {
  readonly children: FakeCommand[] = [];
  readonly options: string[] = [];
  descriptionText = '';
  handler?: (...args: unknown[]) => unknown;

  constructor(readonly specification = 'root') {}

  command(specification: string): FakeCommand {
    const child = new FakeCommand(specification);
    this.children.push(child);
    return child;
  }

  description(text: string): FakeCommand {
    this.descriptionText = text;
    return this;
  }

  option(flags: string): FakeCommand {
    this.options.push(flags);
    return this;
  }

  action(handler: (...args: unknown[]) => unknown): FakeCommand {
    this.handler = handler;
    return this;
  }
}

describe('lib/register-cli', () => {
  it('should register the documented command tree and options', () => {
    const program = new FakeCommand();

    registerDevguardCli(program);

    assert.equal(program.children.length, 1);
    const devguard = program.children[0];
    assert.ok(devguard);
    assert.equal(devguard.specification, 'devguard');
    assert.deepEqual(
      devguard.children.map((command) => command.specification),
      ['init [plugin-path]', 'run', 'tail', 'doctor', 'restore'],
    );
    assert.deepEqual(devguard.children[1]?.options, ['--unsafe-raw-stream']);
    assert.deepEqual(devguard.children[2]?.options, ['--json']);
  });

  it('should fail unfinished actions consistently', () => {
    const program = new FakeCommand();
    registerDevguardCli(program);
    const commands = program.children[0]?.children ?? [];

    for (const command of commands) {
      assert.equal(typeof command.handler, 'function');
      assert.throws(() => command.handler?.(), /not implemented in this structural scaffold/);
    }
  });
});
