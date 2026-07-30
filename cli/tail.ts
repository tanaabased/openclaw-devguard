import {
  defaultCliOutput,
  formatCliAction,
  formatCliField,
  type CliOutput,
  type CliStyles,
} from '../lib/cli-output.ts';
import tailLogFile from '../lib/log-tail.ts';
import { logWarn, type Logger } from '../lib/logger.ts';
import { findProjectRoot, readProjectConfig, resolveProjectPaths } from '../lib/project-config.ts';
import runtimeEventDisplay from '../utils/runtime-event-display.ts';
import assertSupportedHost from '../utils/supported-host.ts';

export interface TailDevguardOptions {
  environment?: NodeJS.ProcessEnv;
  follow?: boolean;
  json?: boolean;
  logger: Logger;
  output?: CliOutput;
  platform?: NodeJS.Platform;
  signal?: AbortSignal;
  styles?: CliStyles;
}

function renderHumanEvent(line: string, styles?: CliStyles): string {
  const display = runtimeEventDisplay(JSON.parse(line));
  const heading = display.target
    ? formatCliAction(display.label, display.target, styles)
    : formatCliField(display.label, '', styles);
  return display.detail ? `${heading} ${display.detail}` : heading.trimEnd();
}

export default async function tailDevguard(
  projectRoot: string,
  options: TailDevguardOptions,
): Promise<void> {
  assertSupportedHost(options.platform);
  const root = await findProjectRoot(projectRoot);
  const environment = options.environment ?? process.env;
  const config = await readProjectConfig(root);
  const paths = resolveProjectPaths(root, config.plugin.id, environment);
  const output = options.output ?? defaultCliOutput;
  const controller = options.signal ? undefined : new AbortController();
  const signal = options.signal ?? controller?.signal;
  const stop = (): void => controller?.abort();

  if (controller) {
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }

  try {
    await tailLogFile(paths.logPath, {
      follow: options.follow,
      signal,
      onLine(line) {
        if (options.json) {
          output.writeStdout(`${line}\n`);
          return;
        }
        try {
          output.writeStdout(`${renderHumanEvent(line, options.styles)}\n`);
        } catch (error) {
          logWarn(options.logger, `ignored malformed audit record: ${String(error)}`);
        }
      },
    });
  } finally {
    if (controller) {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
  }
}
