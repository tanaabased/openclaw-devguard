import loadInitializedProject from '../lib/initialized-project.ts';
import processCommand, {
  type ProcessCommandOptions,
  type ProcessCommandResult,
} from '../lib/process-command.ts';
import isolatedOpenClawEnvironment from '../utils/isolated-openclaw-environment.ts';

export type ShellCommandRunner = (
  command: string,
  args: readonly string[],
  options?: ProcessCommandOptions,
) => Promise<ProcessCommandResult>;

export interface ShellDevguardOptions {
  environment?: NodeJS.ProcessEnv;
  runCommand?: ShellCommandRunner;
}

export default async function shellDevguard(
  projectRoot: string,
  options: ShellDevguardOptions = {},
): Promise<number> {
  const environment = options.environment ?? process.env;
  const { paths, root } = await loadInitializedProject(projectRoot, environment);
  const shell = environment.SHELL?.trim() || '/bin/sh';
  const result = await (options.runCommand ?? processCommand)(shell, ['-l'], {
    allowFailure: true,
    cwd: root,
    env: isolatedOpenClawEnvironment(
      environment,
      { profileName: paths.profileName, stateDirectory: paths.stateDirectory },
      { OPENCLAW_SKIP_CHANNELS: '1' },
    ),
    inherit: true,
    inheritStdin: true,
  });

  return result.code;
}
