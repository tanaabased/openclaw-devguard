import { ensurePortAvailable } from 'openclaw/plugin-sdk/security-runtime';

export interface GatewayPortInspection {
  available: boolean;
  detail?: string;
  host: '127.0.0.1';
  port: number;
}

export type GatewayPortProbe = (port: number, host: string) => Promise<void>;

/** Probes only DevGuard's configured loopback interface without signaling its current owner. */
export default async function inspectGatewayPort(
  port: number,
  probe: GatewayPortProbe = ensurePortAvailable,
): Promise<GatewayPortInspection> {
  const host = '127.0.0.1';
  try {
    await probe(port, host);
    return { available: true, host, port };
  } catch (error) {
    return {
      available: false,
      detail: error instanceof Error ? error.message : String(error),
      host,
      port,
    };
  }
}
