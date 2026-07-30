import doctorDevguard from '../cli/doctor.ts';
import execDevguard from '../cli/exec.ts';
import initDevguard from '../cli/init.ts';
import profileDevguard from '../cli/profile.ts';
import restoreDevguard from '../cli/restore.ts';
import runDevguard from '../cli/run.ts';
import shellDevguard from '../cli/shell.ts';
import tailDevguard from '../cli/tail.ts';
import { defaultCliOutput, type CliOutput } from './cli-output.ts';
import { type Logger, reportError } from './logger.ts';

type Action = (...args: unknown[]) => unknown;
type RepeatableOptionParser = (value: string, previous: string[]) => string[];

export interface CommandLike {
  command(specification: string): CommandLike;
  description(text: string): CommandLike;
  option(
    flags: string,
    description: string,
    parser?: RepeatableOptionParser,
    defaultValue?: string[],
  ): CommandLike;
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
  action: () => Promise<number | void>,
): Promise<void> {
  try {
    const exitCode = await action();
    if (typeof exitCode === 'number' && exitCode !== 0) process.exitCode = exitCode;
  } catch (error) {
    reportError(logger, context, error);
    process.exitCode = 1;
  }
}

export function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function parseStartupTimeoutMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;

  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new Error('--startup-timeout must be a positive whole number of seconds');
  }

  return seconds * 1_000;
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
    .option('--agent <id>', 'Import an additional OpenClaw agent by id.', collectOption, [])
    .option('--reset-agents', 'Forget remembered --agent selections before applying this command.')
    .option('--no-model-profile', 'Do not import model configuration or authentication.')
    .option('--copy-oauth', 'Copy refreshable OAuth credentials into isolated state.')
    .action(async (pluginPath: unknown, commandOptions: unknown) => {
      const flags = (commandOptions ?? {}) as {
        agent?: string[];
        copyOauth?: boolean;
        modelProfile?: boolean;
        resetAgents?: boolean;
      };
      await runCliAction(options.logger, 'initialization failed', async () => {
        await initDevguard(typeof pluginPath === 'string' ? pluginPath : '.', {
          agentIds: flags.agent,
          copyModelProfile: flags.modelProfile !== false,
          copyOAuth: flags.copyOauth,
          logger: options.logger,
          output,
          pluginRoot: options.pluginRoot,
          resetAgents: flags.resetAgents,
        });
      });
    });

  devguard
    .command('profile [plugin-path]')
    .description('Print the isolated OpenClaw profile name.')
    .action(async (pluginPath: unknown) => {
      await runCliAction(options.logger, 'profile lookup failed', async () => {
        await profileDevguard(typeof pluginPath === 'string' ? pluginPath : '.', { output });
      });
    });

  devguard
    .command('exec <openclaw-args...>')
    .description('Run an OpenClaw command against initialized isolated state.')
    .action(async (openClawArguments: unknown) => {
      await runCliAction(options.logger, 'exec failed', async () => {
        if (
          !Array.isArray(openClawArguments) ||
          openClawArguments.some((argument) => typeof argument !== 'string')
        ) {
          throw new TypeError('OpenClaw command arguments must be strings');
        }
        return execDevguard(process.cwd(), openClawArguments);
      });
    });

  devguard
    .command('shell')
    .description('Open a login shell in initialized isolated state.')
    .action(async () => {
      await runCliAction(options.logger, 'shell failed', async () => {
        return shellDevguard(process.cwd());
      });
    });

  devguard
    .command('run')
    .description('Run a plugin under DevGuard supervision.')
    .option(
      '--startup-timeout <seconds>',
      'Wait this many seconds for the Gateway to load the target plugin.',
    )
    .option('--unsafe-raw-stream', 'Allow an unsafe raw event stream for debugging.')
    .option('--once', 'Build, verify the live Gateway, and exit.')
    .action(async (commandOptions: unknown) => {
      const flags = (commandOptions ?? {}) as {
        once?: boolean;
        startupTimeout?: string;
        unsafeRawStream?: boolean;
      };
      await runCliAction(options.logger, 'run failed', async () => {
        await runDevguard(process.cwd(), {
          logger: options.logger,
          once: flags.once,
          output,
          startupTimeoutMs: parseStartupTimeoutMs(flags.startupTimeout),
          unsafeRawStream: flags.unsafeRawStream,
        });
      });
    });

  devguard
    .command('tail')
    .description('Tail DevGuard events.')
    .option('--json', 'Emit newline-delimited JSON events.')
    .option('--no-follow', 'Read current events and exit.')
    .action(async (commandOptions: unknown) => {
      const flags = (commandOptions ?? {}) as { follow?: boolean; json?: boolean };
      await runCliAction(options.logger, 'tail failed', async () => {
        await tailDevguard(process.cwd(), {
          follow: flags.follow,
          json: flags.json,
          logger: options.logger,
          output,
        });
      });
    });

  devguard
    .command('doctor')
    .description('Inspect the current DevGuard development environment.')
    .option('--fix-permissions', 'Remove group and other access from DevGuard-owned artifacts.')
    .option('--json', 'Emit one machine-readable health report.')
    .action(async (commandOptions: unknown) => {
      const flags = (commandOptions ?? {}) as { fixPermissions?: boolean; json?: boolean };
      await runCliAction(options.logger, 'doctor failed', async () => {
        await doctorDevguard(process.cwd(), {
          fixPermissions: flags.fixPermissions,
          json: flags.json,
          logger: options.logger,
          output,
        });
      });
    });

  devguard
    .command('restore')
    .description('Restore the most recent DevGuard-managed development state.')
    .action(async () => {
      await runCliAction(options.logger, 'restore failed', async () => {
        await restoreDevguard(process.cwd(), {
          logger: options.logger,
          output,
        });
      });
    });
}
