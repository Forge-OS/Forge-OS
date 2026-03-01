import { normalizeNetworkProfile } from "./networkProfiles.mjs";

/**
 * @typedef RpcBackendSelectionInput
 * @property {string} targetNetwork
 * @property {string[]} remotePool
 * @property {boolean} localNodeEnabled
 * @property {boolean} localNodeHealthy
 * @property {boolean} [localNodeSynced]
 * @property {boolean} [requireLocalSynced]
 * @property {string} localNodeProfile
 * @property {string|null} localRpcBaseUrl
 */

/**
 * @param {RpcBackendSelectionInput} input
 */
export function selectRpcBackend(input) {
  const remotePool = [...new Set((input.remotePool || []).filter(Boolean))];
  const target = normalizeNetworkProfile(input.targetNetwork);
  const profile = normalizeNetworkProfile(input.localNodeProfile);
  const local = typeof input.localRpcBaseUrl === "string" ? input.localRpcBaseUrl.trim() : "";
  const requireLocalSynced = input.requireLocalSynced !== false;
  const localSynced = input.localNodeSynced !== false;

  const localEligible = Boolean(
    input.localNodeEnabled
    && input.localNodeHealthy
    && (!requireLocalSynced || localSynced)
    && local
    && target === profile,
  );

  if (localEligible) {
    const fallback = remotePool.filter((entry) => entry !== local);
    return {
      source: "local",
      reason: "local_node_enabled_and_healthy",
      rpcBaseUrl: local,
      pool: [local, ...fallback],
    };
  }

  const reason = !input.localNodeEnabled
    ? "local_node_disabled"
    : !input.localNodeHealthy
      ? "local_node_unhealthy"
      : (requireLocalSynced && !localSynced)
        ? "local_node_syncing"
      : target !== profile
        ? "local_profile_mismatch"
        : "local_rpc_missing";

  return {
    source: "remote",
    reason,
    rpcBaseUrl: remotePool[0] || null,
    pool: remotePool,
  };
}
