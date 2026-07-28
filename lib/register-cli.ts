import notImplemented from '../utils/not-implemented.ts';

type Action = (...args: unknown[]) => unknown;

export interface CommandLike {
  command(specification: string): CommandLike;
  description(text: string): CommandLike;
  option(flags: string, description: string): CommandLike;
  action(handler: Action): CommandLike;
}

export default function registerDevguardCli(program: CommandLike): void {
  const devguard = program
    .command('devguard')
    .description('Inspect and manage OpenClaw DevGuard development safeguards.');

  devguard
    .command('init [plugin-path]')
    .description('Initialize DevGuard metadata for a plugin workspace.')
    .action(() => notImplemented('init'));

  devguard
    .command('run')
    .description('Run a plugin under DevGuard supervision.')
    .option('--unsafe-raw-stream', 'Allow an unsafe raw event stream for debugging.')
    .action(() => notImplemented('run'));

  devguard
    .command('tail')
    .description('Tail DevGuard events.')
    .option('--json', 'Emit newline-delimited JSON events.')
    .action(() => notImplemented('tail'));

  devguard
    .command('doctor')
    .description('Inspect the current DevGuard development environment.')
    .action(() => notImplemented('doctor'));

  devguard
    .command('restore')
    .description('Restore the most recent DevGuard-managed development state.')
    .action(() => notImplemented('restore'));
}
