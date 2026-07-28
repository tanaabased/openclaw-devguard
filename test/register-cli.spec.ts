import assert from 'node:assert/strict';

import { type Logger } from '../lib/logger.ts';
import registerDevguardCli, { type CommandLike, runCliAction } from '../lib/register-cli.ts';

const logger: Logger = {
  info() {},
  warn() {},
  error() {},
};

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

    registerDevguardCli(program, { logger });

    assert.equal(program.children.length, 1);
    const devguard = program.children[0];
    assert.ok(devguard);
    assert.equal(devguard.specification, 'devguard');
    assert.deepEqual(
      devguard.children.map((command) => command.specification),
      ['init [plugin-path]', 'run', 'tail', 'doctor', 'restore'],
    );
    assert.deepEqual(devguard.children[1]?.options, ['--unsafe-raw-stream', '--once']);
    assert.deepEqual(devguard.children[2]?.options, ['--json']);
  });

  it('should fail only the explicitly unfinished actions consistently', () => {
    const program = new FakeCommand();
    registerDevguardCli(program, { logger });
    const commands = program.children[0]?.children ?? [];

    for (const command of commands.slice(2)) {
      assert.equal(typeof command.handler, 'function');
      assert.throws(() => command.handler?.(), /not implemented in this structural scaffold/);
    }
  });

  it('should log command failures and set the process exit code without rethrowing', async () => {
    const errors: string[] = [];
    const previousExitCode = process.exitCode;
    const actionLogger: Logger = {
      info() {},
      warn() {},
      error: (message) => errors.push(message),
    };

    try {
      process.exitCode = undefined;
      await runCliAction(actionLogger, 'run failed', async () => {
        throw new Error('broken command');
      });

      assert.equal(process.exitCode, 1);
      assert.deepEqual(errors, ['[devguard] run failed: broken command']);
    } finally {
      process.exitCode = previousExitCode;
    }
  });
});
