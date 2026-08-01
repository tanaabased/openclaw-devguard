import ansis, { Ansis } from 'ansis';
import { defaultRuntime, type OutputRuntimeEnv } from 'openclaw/plugin-sdk/runtime';

export type CliOutput = Pick<OutputRuntimeEnv, 'writeStdout'>;

export interface CliStyles {
  action: (value: string) => string;
  error: (value: string) => string;
  label: (value: string) => string;
  status: (value: string) => string;
  target: (value: string) => string;
}

const CLI_LABEL_WIDTH = 13;

function colorLevel(environment: NodeJS.ProcessEnv): number {
  if (Object.hasOwn(environment, 'NO_COLOR')) return 0;
  if (!Object.hasOwn(environment, 'FORCE_COLOR')) return ansis.level;

  const value = environment.FORCE_COLOR?.trim().toLowerCase();
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return 0;
  if (value === '2' || value === '3') return Number(value);
  return 1;
}

export function createCliStyles(environment: NodeJS.ProcessEnv = process.env): CliStyles {
  const color = new Ansis(colorLevel(environment)).extend({
    tp: '#00c88a',
    ts: '#db2777',
  });

  return {
    action: (value) => color.tp(value),
    error: (value) => color.bold(color.red(value)),
    label: (value) => color.dim(value),
    status: (value) => color.bold(color.green(value)),
    target: (value) => color.ts(value),
  };
}

const defaultCliStyles = createCliStyles();

function formatLabel(label: string): string {
  return label.padEnd(Math.max(CLI_LABEL_WIDTH, label.length + 1));
}

export function formatCliAction(
  action: string,
  target: string,
  styles: CliStyles = defaultCliStyles,
): string {
  return `${styles.action(formatLabel(action))}${styles.target(target)}`;
}

export function formatCliError(
  status: string,
  target: string,
  styles: CliStyles = defaultCliStyles,
): string {
  return `${styles.error(formatLabel(status))}${styles.target(target)}`;
}

export function formatCliStatus(
  status: string,
  target: string,
  styles: CliStyles = defaultCliStyles,
): string {
  return `${styles.status(formatLabel(status))}${styles.target(target)}`;
}

export function formatCliField(
  label: string,
  value: string,
  styles: CliStyles = defaultCliStyles,
): string {
  return `${styles.label(formatLabel(label))}${value}`;
}

export function formatCliTarget(
  label: string,
  target: string,
  styles: CliStyles = defaultCliStyles,
): string {
  return `${styles.label(formatLabel(label))}${styles.target(target)}`;
}

export function writeCliLines(output: CliOutput, lines: readonly string[]): void {
  if (lines.length === 0) return;
  output.writeStdout(`${lines.join('\n')}\n`);
}

export const defaultCliOutput: CliOutput = {
  writeStdout: (value) => defaultRuntime.writeStdout(value),
};
