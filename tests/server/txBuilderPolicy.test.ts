import { beforeEach, describe, expect, it, vi } from "vitest";

function makeEntry(amount: number, daa: number, idSuffix: string) {
  return {
    outpoint: { transactionId: idSuffix.repeat(64).slice(0, 64), index: 0 },
    utxoEntry: {
      amount,
      blockDaaScore: daa,
      isCoinbase: false,
      scriptPublicKey: { version: 0, script: "00" },
    },
  };
}

describe("tx-builder local policy", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.TX_BUILDER_LOCAL_WASM_COIN_SELECTION;
    delete process.env.TX_BUILDER_LOCAL_WASM_MAX_INPUTS;
    delete process.env.TX_BUILDER_LOCAL_WASM_PRIORITY_FEE_MODE;
    delete process.env.TX_BUILDER_LOCAL_WASM_PRIORITY_FEE_OUTPUT_BPS;
    delete process.env.TX_BUILDER_LOCAL_WASM_PRIORITY_FEE_SOMPI;
  });

  it("selects oldest/smallest-first in auto consolidation mode and computes output_bps fee", async () => {
    process.env.TX_BUILDER_LOCAL_WASM_COIN_SELECTION = "auto";
    process.env.TX_BUILDER_LOCAL_WASM_MAX_INPUTS = "3";
    process.env.TX_BUILDER_LOCAL_WASM_PRIORITY_FEE_MODE = "output_bps";
    process.env.TX_BUILDER_LOCAL_WASM_PRIORITY_FEE_OUTPUT_BPS = "10"; // 10 bps

    const policy = await import("../../server/tx-builder/localPolicy.mjs");
    const entries = [
      makeEntry(300_000_000, 120, "a"),
      makeEntry(100_000_000, 100, "b"),
      makeEntry(200_000_000, 110, "c"),
      makeEntry(500_000_000, 130, "d"),
    ];

    const outputsTotalSompi = 250_000_000n;
    const plan = policy.selectUtxoEntriesForLocalBuild({
      entries,
      outputsTotalSompi,
      outputCount: 2,
      requestPriorityFeeSompi: undefined,
      config: policy.readLocalTxPolicyConfig(),
    });

    expect(plan.selectionMode).toBe("auto");
    expect(plan.priorityFeeSompi).toBeGreaterThan(0);
    expect(plan.selectedEntries.length).toBeGreaterThan(0);
    expect(plan.selectedEntries.length).toBeLessThanOrEqual(3);
    expect(plan.selectedAmountSompi).toBeGreaterThanOrEqual(plan.requiredTargetSompi);
    // auto+consolidation should prefer lowest DAA / small UTXOs first
    const selectedDaa = plan.selectedEntries.map((e: any) => Number(e.utxoEntry.blockDaaScore));
    expect(selectedDaa[0]).toBe(100);
  });

  it("honors largest-first and max input cap", async () => {
    process.env.TX_BUILDER_LOCAL_WASM_COIN_SELECTION = "largest-first";
    process.env.TX_BUILDER_LOCAL_WASM_MAX_INPUTS = "1";
    process.env.TX_BUILDER_LOCAL_WASM_PRIORITY_FEE_MODE = "fixed";
    process.env.TX_BUILDER_LOCAL_WASM_PRIORITY_FEE_SOMPI = "0";

    const policy = await import("../../server/tx-builder/localPolicy.mjs");
    const entries = [
      makeEntry(100_000_000, 100, "a"),
      makeEntry(900_000_000, 110, "b"),
      makeEntry(300_000_000, 120, "c"),
    ];
    const plan = policy.selectUtxoEntriesForLocalBuild({
      entries,
      outputsTotalSompi: 200_000_000n,
      outputCount: 1,
      requestPriorityFeeSompi: 0,
      config: policy.readLocalTxPolicyConfig(),
    });

    expect(plan.selectedEntries).toHaveLength(1);
    expect(Number(plan.selectedEntries[0].utxoEntry.amount)).toBe(900_000_000);
    expect(plan.truncatedByMaxInputs).toBe(false);
  });
});

