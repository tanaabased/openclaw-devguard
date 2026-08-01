import { join } from 'node:path';

export interface IsolatedOpenClawProfile {
  profileName: string;
  stateDirectory: string;
}

export function openClawProfileArguments(profileName: string, args: readonly string[]): string[] {
  return ['--profile', profileName, ...args];
}

export default function isolatedOpenClawEnvironment(
  environment: NodeJS.ProcessEnv,
  profile: IsolatedOpenClawProfile,
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    ...environment,
    ...overrides,
    OPENCLAW_CONFIG_PATH: join(profile.stateDirectory, 'openclaw.json'),
    OPENCLAW_PROFILE: profile.profileName,
    OPENCLAW_STATE_DIR: profile.stateDirectory,
  };
}
