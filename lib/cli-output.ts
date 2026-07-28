import { defaultRuntime, type OutputRuntimeEnv } from 'openclaw/plugin-sdk/runtime';

export type CliOutput = Pick<OutputRuntimeEnv, 'writeStdout'>;

export const defaultCliOutput: CliOutput = {
  writeStdout: (value) => defaultRuntime.writeStdout(value),
};
