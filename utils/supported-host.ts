export const SUPPORTED_HOST_PLATFORMS = [
  'darwin',
  'linux',
] as const satisfies readonly NodeJS.Platform[];

/**
 * Rejects hosts outside the package's supported macOS and Linux contract.
 *
 * @throws {Error} When the current or injected platform is unsupported.
 */
export default function assertSupportedHost(platform: NodeJS.Platform = process.platform): void {
  if (SUPPORTED_HOST_PLATFORMS.some((supported) => supported === platform)) return;
  throw new Error(`DevGuard supports macOS and Linux; platform ${platform} is unsupported`);
}
