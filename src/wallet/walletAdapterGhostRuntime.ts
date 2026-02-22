import { createGhostBridgeRuntime } from "./walletAdapterGhostBridge";
import { GHOST_PROVIDER_SCAN_TIMEOUT_MS } from "./walletAdapterInternals";

const ghostBridgeRuntime = createGhostBridgeRuntime({
  scanTimeoutMs: GHOST_PROVIDER_SCAN_TIMEOUT_MS,
});

export type { GhostProviderInfo } from "./walletAdapterGhostBridge";

export const probeGhostProviders = (...args: Parameters<typeof ghostBridgeRuntime.probeGhostProviders>) =>
  ghostBridgeRuntime.probeGhostProviders(...args);

export const ghostInvoke = (...args: Parameters<typeof ghostBridgeRuntime.ghostInvoke>) =>
  ghostBridgeRuntime.ghostInvoke(...args);

