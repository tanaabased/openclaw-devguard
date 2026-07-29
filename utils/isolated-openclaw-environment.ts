export default function isolatedOpenClawEnvironment(
  environment: NodeJS.ProcessEnv,
  stateDirectory: string,
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const isolated: NodeJS.ProcessEnv = {
    ...environment,
    ...overrides,
    OPENCLAW_STATE_DIR: stateDirectory,
  };
  delete isolated.OPENCLAW_CONFIG_PATH;
  return isolated;
}
