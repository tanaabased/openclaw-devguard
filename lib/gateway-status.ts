export interface GatewayStatus {
  ambientChannelsDisabled?: boolean;
  denyUnknownTools?: boolean;
  pluginId?: string;
  pluginBuildId?: string;
  hookRegistered?: boolean;
  policyMode?: string;
  profileName?: string;
  logPath?: string;
  gatewayProcessId?: number;
  stateDirectory?: string;
}

export class GatewayStatusTimeoutError extends Error {
  readonly expectedBuildId: string;
  readonly lastObservedBuildId?: string;
  readonly timeoutMs: number;

  constructor(options: {
    expectedBuildId: string;
    lastObservedBuildId?: string;
    lastQueryError?: unknown;
    timeoutMs: number;
  }) {
    super(`DevGuard Gateway did not load the expected plugin build within ${options.timeoutMs}ms`, {
      cause: options.lastQueryError,
    });
    this.name = 'GatewayStatusTimeoutError';
    this.expectedBuildId = options.expectedBuildId;
    this.lastObservedBuildId = options.lastObservedBuildId;
    this.timeoutMs = options.timeoutMs;
  }
}

export interface WaitForGatewayStatusOptions {
  delay?: (milliseconds: number) => Promise<void>;
  expectedBuildId: string;
  expectedProfileName?: string;
  expectedPolicyMode?: string;
  expectedStateDirectory?: string;
  isCurrent: () => boolean;
  now?: () => number;
  pollIntervalMs?: number;
  queryStatus: () => Promise<unknown>;
  timeoutMs: number;
}

function parseGatewayStatus(value: unknown): GatewayStatus {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError('Gateway returned an invalid DevGuard status payload');
  }
  return value as GatewayStatus;
}

function validateReadyStatus(status: GatewayStatus, options: WaitForGatewayStatusOptions): void {
  if (status.hookRegistered !== true) {
    throw new Error('Gateway did not register the DevGuard hook');
  }
  const expectedPolicyMode = options.expectedPolicyMode ?? 'probe';
  if (status.policyMode !== expectedPolicyMode) {
    throw new Error(`Gateway is not using DevGuard ${expectedPolicyMode} mode`);
  }
  if (status.denyUnknownTools !== true) {
    throw new Error('Gateway is not denying unknown tools');
  }
  if (
    options.expectedProfileName !== undefined &&
    status.profileName !== options.expectedProfileName
  ) {
    throw new Error('Gateway is not using the expected OpenClaw profile');
  }
  if (
    options.expectedStateDirectory !== undefined &&
    status.stateDirectory !== options.expectedStateDirectory
  ) {
    throw new Error('Gateway is not using the expected OpenClaw state directory');
  }
}

export default async function waitForGatewayStatus(
  options: WaitForGatewayStatusOptions,
): Promise<GatewayStatus | undefined> {
  const now = options.now ?? Date.now;
  const delay =
    options.delay ??
    ((milliseconds: number) =>
      new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds)));
  const deadline = now() + options.timeoutMs;
  const pollIntervalMs = options.pollIntervalMs ?? 200;
  let lastObservedBuildId: string | undefined;
  let lastQueryError: unknown;

  while (now() < deadline) {
    if (!options.isCurrent()) return undefined;

    let result: unknown;
    try {
      result = await options.queryStatus();
      lastQueryError = undefined;
    } catch (error) {
      lastQueryError = error;
      await delay(pollIntervalMs);
      continue;
    }

    if (!options.isCurrent()) return undefined;

    const status = parseGatewayStatus(result);
    lastObservedBuildId = status.pluginBuildId;
    if (status.pluginBuildId === options.expectedBuildId) {
      validateReadyStatus(status, options);
      return status;
    }

    await delay(pollIntervalMs);
  }

  if (!options.isCurrent()) return undefined;

  throw new GatewayStatusTimeoutError({
    expectedBuildId: options.expectedBuildId,
    lastObservedBuildId,
    lastQueryError,
    timeoutMs: options.timeoutMs,
  });
}
