export interface RpcBackendSelectionInput {
  targetNetwork: string;
  remotePool: string[];
  localNodeEnabled: boolean;
  localNodeHealthy: boolean;
  localNodeSynced?: boolean;
  requireLocalSynced?: boolean;
  localNodeProfile: string | null;
  localRpcEndpoint: string | null;
}

export interface RpcBackendSelectionResult {
  pool: string[];
  source: "local" | "remote";
  reason: string;
}

export function selectRpcBackend(input: RpcBackendSelectionInput): RpcBackendSelectionResult {
  const remotePool = [...new Set((input.remotePool || []).filter(Boolean))];
  const normalizedTarget = normalizeNetworkProfile(input.targetNetwork);
  const normalizedLocalProfile = normalizeNetworkProfile(input.localNodeProfile || "");
  const requireLocalSynced = input.requireLocalSynced !== false;
  const localSynced = input.localNodeSynced !== false;
  const localEligible = Boolean(
    input.localNodeEnabled
    && input.localNodeHealthy
    && (!requireLocalSynced || localSynced)
    && input.localRpcEndpoint
    && normalizedTarget
    && normalizedLocalProfile
    && normalizedTarget === normalizedLocalProfile,
  );

  if (localEligible) {
    const local = String(input.localRpcEndpoint).trim();
    const fallback = remotePool.filter((endpoint) => endpoint !== local);
    return {
      pool: [local, ...fallback],
      source: "local",
      reason: "local_node_enabled_and_healthy",
    };
  }

  const reason = !input.localNodeEnabled
    ? "local_node_disabled"
    : !input.localNodeHealthy
      ? "local_node_unhealthy"
      : (requireLocalSynced && !localSynced)
        ? "local_node_syncing"
      : normalizedTarget !== normalizedLocalProfile
        ? "local_profile_mismatch"
        : "local_endpoint_missing";

  return {
    pool: remotePool,
    source: "remote",
    reason,
  };
}

export function normalizeNetworkProfile(profile: string): string {
  const raw = String(profile || "").trim().toLowerCase().replace(/_/g, "-");
  if (!raw) return "";
  if (raw === "mainnet" || raw === "main") return "mainnet";
  if (raw === "testnet-10" || raw === "tn10") return "testnet-10";
  if (raw === "testnet-11" || raw === "tn11") return "testnet-11";
  if (raw === "testnet-12" || raw === "tn12") return "testnet-12";
  if (raw === "testnet") return "testnet-10";
  return raw;
}
