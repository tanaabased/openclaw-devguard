import assert from 'node:assert/strict';

import { type Logger } from '../lib/logger.ts';
import registerDevguardCli, {
  collectOption,
  type CommandLike,
  parseStartupTimeoutMs,
  runCliAction,
} from '../lib/register-cli.ts';

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
      new Set([
        'init [plugin-path]',
        'profile [plugin-path]',
        'exec <openclaw-args...>',
        'run',
        'tail',
        'doctor',
        'restore',
      ]),
    );
    assert.deepEqual(
      new Set(findCommand(devguard, 'init [plugin-path]').options),
      new Set(['--agent <id>', '--no-model-profile', '--copy-oauth']),
    );
    assert.deepEqual(
      new Set(findCommand(devguard, 'run').options),
      new Set(['--startup-timeout <seconds>', '--unsafe-raw-stream', '--once']),
    );
    assert.deepEqual(
      new Set(findCommand(devguard, 'tail').options),
      new Set(['--json', '--no-follow']),
    );
  });

  it('should collect repeated agent options in command-line order', () => {
    assert.deepEqual(collectOption('ops', collectOption('main', [])), ['main', 'ops']);
  });

  it('should convert a positive startup timeout from seconds to milliseconds', () => {
    assert.equal(parseStartupTimeoutMs(undefined), undefined);
    assert.equal(parseStartupTimeoutMs('60'), 60_000);
  });

  it('should reject invalid startup timeouts', () => {
    for (const value of ['0', '-1', '1.5', 'later']) {
      assert.throws(() => parseStartupTimeoutMs(value), /positive whole number/);
    }
  });

  it('should expose handlers for every implemented command', () => {
    const program = new FakeCommand();
    registerDevguardCli(program, { logger });
    const devguard = findCommand(program, 'devguard');

    for (const specification of [
      'profile [plugin-path]',
      'exec <openclaw-args...>',
      'doctor',
      'restore',
    ]) {
      const command = findCommand(devguard, specification);
      assert.equal(typeof command.handler, 'function');
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

  it('should preserve a child command exit code', async () => {
    const previousExitCode = process.exitCode;

    try {
      process.exitCode = undefined;
      await runCliAction(logger, 'exec failed', async () => 23);

      assert.equal(process.exitCode, 23);
    } finally {
      process.exitCode = previousExitCode;
    }
  });
});
