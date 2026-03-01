import { describe, expect, it } from "vitest";
import { selectRpcBackend } from "../../server/local-node/modules/rpcBackendSelector.mjs";

describe("local-node service rpc backend selector", () => {
  it("returns local source when enabled + healthy + matching profile", () => {
    const result = selectRpcBackend({
      targetNetwork: "testnet-11",
      remotePool: ["https://api-tn11.kaspa.org"],
      localNodeEnabled: true,
      localNodeHealthy: true,
      localNodeProfile: "tn11",
      localRpcBaseUrl: "http://127.0.0.1:16310",
    });

    expect(result.source).toBe("local");
    expect(result.reason).toBe("local_node_enabled_and_healthy");
    expect(result.rpcBaseUrl).toBe("http://127.0.0.1:16310");
    expect(result.pool[0]).toBe("http://127.0.0.1:16310");
  });

  it("returns remote source when local is unhealthy", () => {
    const result = selectRpcBackend({
      targetNetwork: "mainnet",
      remotePool: ["https://api.kaspa.org"],
      localNodeEnabled: true,
      localNodeHealthy: false,
      localNodeProfile: "mainnet",
      localRpcBaseUrl: "http://127.0.0.1:16110",
    });

    expect(result.source).toBe("remote");
    expect(result.reason).toBe("local_node_unhealthy");
    expect(result.rpcBaseUrl).toBe("https://api.kaspa.org");
  });

  it("returns remote source while local is still syncing when sync is required", () => {
    const result = selectRpcBackend({
      targetNetwork: "mainnet",
      remotePool: ["https://api.kaspa.org"],
      localNodeEnabled: true,
      localNodeHealthy: true,
      localNodeSynced: false,
      requireLocalSynced: true,
      localNodeProfile: "mainnet",
      localRpcBaseUrl: "http://127.0.0.1:16110",
    });

    expect(result.source).toBe("remote");
    expect(result.reason).toBe("local_node_syncing");
  });

  it("can select local while syncing when sync requirement is disabled", () => {
    const result = selectRpcBackend({
      targetNetwork: "mainnet",
      remotePool: ["https://api.kaspa.org"],
      localNodeEnabled: true,
      localNodeHealthy: true,
      localNodeSynced: false,
      requireLocalSynced: false,
      localNodeProfile: "mainnet",
      localRpcBaseUrl: "http://127.0.0.1:16110",
    });

    expect(result.source).toBe("local");
    expect(result.reason).toBe("local_node_enabled_and_healthy");
  });
});
