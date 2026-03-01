import { describe, expect, it, vi } from "vitest";
import {
  createDeterministicExecutionKernel,
  DeterministicExecutionError,
  type KaspaExecutionIntent,
} from "../../extension/tx/kernel";
import type { PendingTx } from "../../extension/tx/types";

function makePendingTx(id: string, state: PendingTx["state"] = "BUILDING"): PendingTx {
  return {
    id,
    state,
    fromAddress: "kaspa:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq9f6a",
    network: "mainnet",
    inputs: [],
    outputs: [{ address: "kaspa:qprecipient", amount: 1_000_000n }],
    changeOutput: null,
    fee: 1_000n,
    builtAt: Date.now(),
  };
}

describe("deterministic execution kernel", () => {
  it("runs intent -> validate -> sign -> broadcast -> reconcile (single recipient)", async () => {
    const built = makePendingTx("tx-built", "BUILDING");
    const validated = { ...built, state: "DRY_RUN_OK", fee: 2_000n };
    const signed = { ...validated, state: "SIGNED" as const, signedTxPayload: "{\"transaction\":{}}", signedAt: Date.now() };
    const confirming = { ...signed, state: "CONFIRMING" as const, txId: "0xkaspatxid" };
    const confirmed = { ...confirming, state: "CONFIRMED" as const, confirmations: 1, confirmedAt: Date.now() };

    const deps = {
      buildTransaction: vi.fn(async () => built),
      buildBatchTransaction: vi.fn(async () => {
        throw new Error("should not call batch builder");
      }),
      dryRunValidate: vi.fn(async () => ({ valid: true, estimatedFee: 2_000n, changeAmount: 0n, errors: [] as string[] })),
      signTransaction: vi.fn(async () => signed),
      broadcastTransaction: vi.fn(async () => confirming),
      waitForKaspaConfirmation: vi.fn(async () => confirmed),
      addPendingTx: vi.fn(async () => {}),
      updatePendingTx: vi.fn(async () => {}),
    };

    const kernel = createDeterministicExecutionKernel(deps);
    const stages: string[] = [];
    const result = await kernel.executeKaspaIntent(
      {
        fromAddress: built.fromAddress,
        network: "mainnet",
        recipients: [{ address: "kaspa:qprecipient", amountKas: 0.01 }],
      },
      {
        onUpdate: ({ stage }) => {
          stages.push(stage);
        },
      },
    );

    expect(result.state).toBe("CONFIRMED");
    expect(result.txId).toBe("0xkaspatxid");
    expect(deps.buildTransaction).toHaveBeenCalledTimes(1);
    expect(deps.buildBatchTransaction).not.toHaveBeenCalled();
    expect(deps.signTransaction).toHaveBeenCalledTimes(1);
    expect(deps.broadcastTransaction).toHaveBeenCalledTimes(1);
    expect(deps.waitForKaspaConfirmation).toHaveBeenCalledTimes(1);
    expect(stages).toEqual(["build", "validate", "sign", "broadcast", "reconcile"]);
  });

  it("uses batch builder for multi-recipient intents", async () => {
    const built = makePendingTx("batch-built", "BUILDING");
    const deps = {
      buildTransaction: vi.fn(async () => {
        throw new Error("single builder should not be used");
      }),
      buildBatchTransaction: vi.fn(async () => built),
      dryRunValidate: vi.fn(async () => ({ valid: true, estimatedFee: 1_500n, changeAmount: 0n, errors: [] as string[] })),
      signTransaction: vi.fn(async () => ({ ...built, state: "SIGNED" as const, signedTxPayload: "{}" })),
      broadcastTransaction: vi.fn(async () => ({ ...built, state: "CONFIRMING" as const, txId: "tx123" })),
      waitForKaspaConfirmation: vi.fn(async () => ({ ...built, state: "CONFIRMED" as const, txId: "tx123", confirmations: 1 })),
      addPendingTx: vi.fn(async () => {}),
      updatePendingTx: vi.fn(async () => {}),
    };

    const kernel = createDeterministicExecutionKernel(deps);
    const intent: KaspaExecutionIntent = {
      fromAddress: built.fromAddress,
      network: "mainnet",
      recipients: [
        { address: "kaspa:qprecipient1", amountKas: 0.01 },
        { address: "kaspa:qprecipient2", amountKas: 0.02 },
      ],
      agentJobId: "agent_job_1",
      opReturnHex: "46474f53",
    };

    await kernel.executeKaspaIntent(intent);
    expect(deps.buildBatchTransaction).toHaveBeenCalledTimes(1);
    expect(deps.buildBatchTransaction.mock.calls[0]?.[3]).toEqual({
      agentJobId: "agent_job_1",
      opReturnHex: "46474f53",
    });
  });

  it("throws deterministic validation error on dry-run failure and persists fail state", async () => {
    const built = makePendingTx("dry-run-fail", "BUILDING");
    const deps = {
      buildTransaction: vi.fn(async () => built),
      buildBatchTransaction: vi.fn(async () => built),
      dryRunValidate: vi.fn(async () => ({
        valid: false,
        estimatedFee: 1_000n,
        changeAmount: 0n,
        errors: ["UTXO_SPENT"],
      })),
      signTransaction: vi.fn(async () => built),
      broadcastTransaction: vi.fn(async () => built),
      waitForKaspaConfirmation: vi.fn(async () => built),
      addPendingTx: vi.fn(async () => {}),
      updatePendingTx: vi.fn(async () => {}),
    };
    const kernel = createDeterministicExecutionKernel(deps);

    await expect(
      kernel.buildAndValidateKaspaIntent({
        fromAddress: built.fromAddress,
        network: "mainnet",
        recipients: [{ address: "kaspa:qprecipient", amountKas: 0.01 }],
      }),
    ).rejects.toBeInstanceOf(DeterministicExecutionError);

    expect(deps.updatePendingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "dry-run-fail",
        state: "DRY_RUN_FAIL",
        error: "UTXO_SPENT",
      }),
    );
    expect(deps.signTransaction).not.toHaveBeenCalled();
  });

  it("can return immediately after broadcast when confirmation wait is disabled", async () => {
    const tx = makePendingTx("signed", "DRY_RUN_OK");
    const signed = { ...tx, state: "SIGNED" as const, signedTxPayload: "{\"transaction\":{}}" };
    const confirming = { ...signed, state: "CONFIRMING" as const, txId: "tx-id-123" };
    const deps = {
      buildTransaction: vi.fn(async () => tx),
      buildBatchTransaction: vi.fn(async () => tx),
      dryRunValidate: vi.fn(async () => ({ valid: true, estimatedFee: tx.fee, changeAmount: 0n, errors: [] as string[] })),
      signTransaction: vi.fn(async () => signed),
      broadcastTransaction: vi.fn(async () => confirming),
      waitForKaspaConfirmation: vi.fn(async () => ({ ...confirming, state: "CONFIRMED" as const, confirmations: 1 })),
      addPendingTx: vi.fn(async () => {}),
      updatePendingTx: vi.fn(async () => {}),
    };
    const kernel = createDeterministicExecutionKernel(deps);

    const result = await kernel.signBroadcastAndReconcileKaspaTx(tx, { awaitConfirmation: false });
    expect(result.state).toBe("CONFIRMING");
    expect(result.txId).toBe("tx-id-123");
    expect(deps.waitForKaspaConfirmation).not.toHaveBeenCalled();
  });

  it("emits unified telemetry events with stable runId across stages", async () => {
    const built = makePendingTx("telemetry-built", "BUILDING");
    const validated = { ...built, state: "DRY_RUN_OK", fee: 3_000n };
    const signed = { ...validated, state: "SIGNED" as const, signedTxPayload: "{\"transaction\":{}}" };
    const confirming = { ...signed, state: "CONFIRMING" as const, txId: "telemetry_txid" };
    const confirmed = {
      ...confirming,
      state: "CONFIRMED" as const,
      confirmations: 1,
      receiptSourceBackend: "local" as const,
      receiptSourceReason: "local_node_enabled_and_healthy",
      receiptSourceEndpoint: "http://127.0.0.1:16110",
    };

    const appendExecutionTelemetryEvent = vi.fn(async () => ({}));
    const deps = {
      buildTransaction: vi.fn(async () => built),
      buildBatchTransaction: vi.fn(async () => built),
      dryRunValidate: vi.fn(async () => ({ valid: true, estimatedFee: 3_000n, changeAmount: 0n, errors: [] as string[] })),
      signTransaction: vi.fn(async () => signed),
      broadcastTransaction: vi.fn(async () => confirming),
      waitForKaspaConfirmation: vi.fn(async () => confirmed),
      addPendingTx: vi.fn(async () => {}),
      updatePendingTx: vi.fn(async () => {}),
      appendExecutionTelemetryEvent,
    };
    const kernel = createDeterministicExecutionKernel(deps);

    await kernel.executeKaspaIntent(
      {
        fromAddress: built.fromAddress,
        network: "mainnet",
        recipients: [{ address: "kaspa:qprecipient", amountKas: 0.01 }],
      },
      {
        telemetry: {
          channel: "agent",
          runId: "run_agent_1",
          context: { agentId: "agent_1" },
        },
      },
    );

    expect(appendExecutionTelemetryEvent).toHaveBeenCalled();
    const runIds = appendExecutionTelemetryEvent.mock.calls.map((call) => call?.[0]?.runId);
    expect(new Set(runIds)).toEqual(new Set(["run_agent_1"]));
    const stages = appendExecutionTelemetryEvent.mock.calls.map((call) => call?.[0]?.stage);
    expect(stages).toEqual(["build", "validate", "sign", "broadcast", "reconcile"]);
  });
});
