import initDevguard from '../cli/init.ts';
import runDevguard from '../cli/run.ts';
import tailDevguard from '../cli/tail.ts';
import notImplemented from '../utils/not-implemented.ts';
import { defaultCliOutput, type CliOutput } from './cli-output.ts';
import { type Logger, reportError } from './logger.ts';

type Action = (...args: unknown[]) => unknown;

export interface CommandLike {
  command(specification: string): CommandLike;
  description(text: string): CommandLike;
  option(flags: string, description: string): CommandLike;
  action(handler: Action): CommandLike;
}

export interface RegisterDevguardCliOptions {
  logger: Logger;
  output?: CliOutput;
  pluginRoot?: string;
}

export async function runCliAction(
  logger: Logger,
  context: string,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    reportError(logger, context, error);
    process.exitCode = 1;
  }
}

export default function registerDevguardCli(
  program: CommandLike,
  options: RegisterDevguardCliOptions,
): void {
  const output = options.output ?? defaultCliOutput;
  const devguard = program
    .command('devguard')
    .description('Inspect and manage OpenClaw DevGuard development safeguards.');

  devguard
    .command('init [plugin-path]')
    .description('Initialize DevGuard metadata for a plugin workspace.')
    .action(async (pluginPath: unknown) => {
      await runCliAction(options.logger, 'initialization failed', async () => {
        await initDevguard(typeof pluginPath === 'string' ? pluginPath : '.', {
          logger: options.logger,
          output,
          pluginRoot: options.pluginRoot,
        });
      });
    });

  devguard
    .command('run')
    .description('Run a plugin under DevGuard supervision.')
    .option('--unsafe-raw-stream', 'Allow an unsafe raw event stream for debugging.')
    .option('--once', 'Build, verify the live Gateway, and exit.')
    .action(async (commandOptions: unknown) => {
      const flags = (commandOptions ?? {}) as { once?: boolean; unsafeRawStream?: boolean };
      await runCliAction(options.logger, 'run failed', async () => {
        await runDevguard(process.cwd(), {
          logger: options.logger,
          once: flags.once,
          output,
          unsafeRawStream: flags.unsafeRawStream,
        });
      });
    });

  devguard
    .command('tail')
    .description('Tail DevGuard events.')
    .option('--json', 'Emit newline-delimited JSON events.')
    .action(async (commandOptions: unknown) => {
      const flags = (commandOptions ?? {}) as { json?: boolean };
      await runCliAction(options.logger, 'tail failed', async () => {
        await tailDevguard(process.cwd(), {
          json: flags.json,
          logger: options.logger,
          output,
        });
      });
    });

  devguard
    .command('doctor')
    .description('Inspect the current DevGuard development environment.')
    .action(() => notImplemented('doctor'));

  devguard
    .command('restore')
    .description('Restore the most recent DevGuard-managed development state.')
    .action(() => notImplemented('restore'));
}
