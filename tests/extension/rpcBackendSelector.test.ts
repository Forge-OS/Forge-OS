import { describe, expect, it } from "vitest";
import { normalizeNetworkProfile, selectRpcBackend } from "../../extension/network/rpcBackendSelector";

describe("extension rpc backend selector", () => {
  it("chooses local rpc first when local mode is healthy and profile matches", () => {
    const result = selectRpcBackend({
      targetNetwork: "tn12",
      remotePool: ["https://api-tn12.kaspa.org", "https://mirror.example/tn12"],
      localNodeEnabled: true,
      localNodeHealthy: true,
      localNodeProfile: "testnet-12",
      localRpcEndpoint: "http://127.0.0.1:16410",
    });

    expect(result.source).toBe("local");
    expect(result.reason).toBe("local_node_enabled_and_healthy");
    expect(result.pool[0]).toBe("http://127.0.0.1:16410");
    expect(result.pool).toContain("https://api-tn12.kaspa.org");
  });

  it("falls back to remote when local profile mismatches target network", () => {
    const result = selectRpcBackend({
      targetNetwork: "mainnet",
      remotePool: ["https://api.kaspa.org"],
      localNodeEnabled: true,
      localNodeHealthy: true,
      localNodeProfile: "testnet-11",
      localRpcEndpoint: "http://127.0.0.1:16310",
    });

    expect(result.source).toBe("remote");
    expect(result.reason).toBe("local_profile_mismatch");
    expect(result.pool).toEqual(["https://api.kaspa.org"]);
  });

  it("falls back to remote while local node is syncing when sync gating is enabled", () => {
    const result = selectRpcBackend({
      targetNetwork: "mainnet",
      remotePool: ["https://api.kaspa.org"],
      localNodeEnabled: true,
      localNodeHealthy: true,
      localNodeSynced: false,
      requireLocalSynced: true,
      localNodeProfile: "mainnet",
      localRpcEndpoint: "http://127.0.0.1:16110",
    });

    expect(result.source).toBe("remote");
    expect(result.reason).toBe("local_node_syncing");
  });

  it("normalizes common aliases for network profiles", () => {
    expect(normalizeNetworkProfile("tn10")).toBe("testnet-10");
    expect(normalizeNetworkProfile("TN11")).toBe("testnet-11");
    expect(normalizeNetworkProfile("testnet_12")).toBe("testnet-12");
    expect(normalizeNetworkProfile("main")).toBe("mainnet");
  });
});
