import loadInitializedProject from '../lib/initialized-project.ts';
import processCommand, {
  type ProcessCommandOptions,
  type ProcessCommandResult,
} from '../lib/process-command.ts';
import isolatedOpenClawEnvironment, {
  openClawProfileArguments,
} from '../utils/isolated-openclaw-environment.ts';
import assertSupportedHost from '../utils/supported-host.ts';

export type ExecCommandRunner = (
  command: string,
  args: readonly string[],
  options?: ProcessCommandOptions,
) => Promise<ProcessCommandResult>;

export interface ExecDevguardOptions {
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  runCommand?: ExecCommandRunner;
}

export default async function execDevguard(
  projectRoot: string,
  openClawArguments: readonly string[],
  options: ExecDevguardOptions = {},
): Promise<number> {
  assertSupportedHost(options.platform);
  if (openClawArguments.length === 0) {
    throw new Error('OpenClaw command arguments are required after --');
  }

  const environment = options.environment ?? process.env;
  const { paths, root } = await loadInitializedProject(projectRoot, environment);

  const result = await (options.runCommand ?? processCommand)(
    'openclaw',
    openClawProfileArguments(paths.profileName, openClawArguments),
    {
      allowFailure: true,
      cwd: root,
      env: isolatedOpenClawEnvironment(
        environment,
        { profileName: paths.profileName, stateDirectory: paths.stateDirectory },
        { OPENCLAW_SKIP_CHANNELS: '1' },
      ),
      inherit: true,
      inheritStdin: true,
    },
  );

  return result.code;
}
