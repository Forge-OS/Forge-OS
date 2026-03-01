import { describe, expect, it } from "vitest";
import { describeKaspaProviderPreset, getKaspaEndpointHealthForPool } from "../../extension/network/kaspaClient";

describe("kaspa provider preset descriptor", () => {
  it("marks custom preset as fallback when no custom endpoint is set", () => {
    const descriptor = describeKaspaProviderPreset("mainnet", "custom", null);
    expect(descriptor.preset).toBe("custom");
    expect(descriptor.usesOfficialFallback).toBe(true);
    expect(descriptor.effectivePool.length).toBeGreaterThan(0);
  });

  it("prepends custom endpoint when present", () => {
    const custom = "https://rpc.example.local";
    const descriptor = describeKaspaProviderPreset("testnet-12", "custom", custom);
    expect(descriptor.usesOfficialFallback).toBe(false);
    expect(descriptor.effectivePool[0]).toBe(custom);
  });

  it("returns required env key hints for provider presets", () => {
    const igra = describeKaspaProviderPreset("testnet-10", "igra", null);
    const kasplex = describeKaspaProviderPreset("testnet-11", "kasplex", null);
    const local = describeKaspaProviderPreset("mainnet", "local", null);
    expect(igra.requiredEnvKeys[0]).toBe("VITE_KASPA_IGRA_TN10_API_ENDPOINTS");
    expect(kasplex.requiredEnvKeys[0]).toBe("VITE_KASPA_KASPLEX_TN11_API_ENDPOINTS");
    expect(local.requiredEnvKeys[0]).toBe("VITE_LOCAL_NODE_CONTROL_URL");
  });

  it("provides working built-in pools for igra and kasplex presets", () => {
    const igra = describeKaspaProviderPreset("mainnet", "igra", null);
    const kasplex = describeKaspaProviderPreset("testnet-12", "kasplex", null);
    expect(igra.effectivePool.length).toBeGreaterThan(0);
    expect(kasplex.effectivePool.length).toBeGreaterThan(0);
    expect(igra.usesOfficialFallback).toBe(false);
    expect(kasplex.usesOfficialFallback).toBe(false);
  });

  it("uses pool override values when provided for a preset", () => {
    const descriptor = describeKaspaProviderPreset(
      "mainnet",
      "official",
      null,
      { official: ["https://rpc-a.example", "https://rpc-b.example"] },
    );
    expect(descriptor.effectivePool[0]).toBe("https://rpc-a.example");
    expect(descriptor.effectivePool[1]).toBe("https://rpc-b.example");
    expect(descriptor.usesOfficialFallback).toBe(false);
  });

  it("returns health snapshots for the exact runtime pool", () => {
    const pool = [
      "https://rpc-a.example",
      "https://rpc-b.example",
      "https://rpc-a.example",
    ];
    const snapshots = getKaspaEndpointHealthForPool(pool);
    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((row) => row.base)).toEqual([
      "https://rpc-a.example",
      "https://rpc-b.example",
    ]);
  });
});
