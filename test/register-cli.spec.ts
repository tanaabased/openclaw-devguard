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

function findCommand(parent: FakeCommand, specification: string): FakeCommand {
  const command = parent.children.find((candidate) => candidate.specification === specification);
  assert.ok(command, `command ${specification} should be registered`);
  return command;
}

describe('lib/register-cli', () => {
  it('should register the documented command tree and options', () => {
    const program = new FakeCommand();

    registerDevguardCli(program, { logger });

    const devguard = findCommand(program, 'devguard');
    assert.deepEqual(
      new Set(devguard.children.map((command) => command.specification)),
      new Set(['init [plugin-path]', 'run', 'tail', 'doctor', 'restore']),
    );
    assert.deepEqual(
      new Set(findCommand(devguard, 'run').options),
      new Set(['--unsafe-raw-stream', '--once']),
    );
    assert.deepEqual(new Set(findCommand(devguard, 'tail').options), new Set(['--json']));
  });

  it('should fail only the explicitly unfinished actions consistently', () => {
    const program = new FakeCommand();
    registerDevguardCli(program, { logger });
    const devguard = findCommand(program, 'devguard');

    for (const specification of ['tail', 'doctor', 'restore']) {
      const command = findCommand(devguard, specification);
      assert.equal(typeof command.handler, 'function');
      assert.throws(
        () => command.handler?.(),
        (error: unknown) => error instanceof Error && error.name === 'DevguardNotImplementedError',
      );
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
      assert.equal(errors.length, 1);
      assert.match(errors[0] ?? '', /run failed/);
      assert.match(errors[0] ?? '', /broken command/);
    } finally {
      process.exitCode = previousExitCode;
    }
  });
});
