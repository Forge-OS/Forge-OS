// Transaction builder — coin selection + kaspa-wasm Generator.
//
// Uses the kaspa-wasm Generator class for correct mass-based fee calculation
// and UTXO-to-transaction mapping. If the Generator API differs between
// kaspa-wasm patch versions, falls back to a manual construction path.
//
// NOTE: kaspa-wasm is loaded lazily to avoid blocking the popup on WASM init.

import type { PendingTx, TxOutput } from "./types";
import type { Utxo } from "../utxo/types";
import { selectUtxos, kasToSompi } from "../utxo/utxoSync";
import { estimateFee } from "../network/kaspaClient";
import { getLockedUtxoKeys } from "./store";
import { getOrSyncUtxos } from "../utxo/utxoSync";
import { loadKaspaWasm } from "../../src/wallet/kaspaWasmLoader";

const ENV = (import.meta as any)?.env ?? {};

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number(ENV?.[name]);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

// Fee policy controls (env configurable for production tuning).
const TX_FEE_SAFETY_BPS = readIntEnv("VITE_EXT_TX_FEE_SAFETY_BPS", 11_500, 10_000, 30_000);
const TX_FEE_MIN_SOMPI = BigInt(readIntEnv("VITE_EXT_TX_FEE_MIN_SOMPI", 1_000, 1, 1_000_000_000));
const TX_FEE_MAX_SOMPI = BigInt(readIntEnv("VITE_EXT_TX_FEE_MAX_SOMPI", 200_000_000, 1_000, 5_000_000_000));

function applyFeePolicy(baseFee: bigint): bigint {
  const buffered = (baseFee * BigInt(TX_FEE_SAFETY_BPS) + 9_999n) / 10_000n;
  if (buffered < TX_FEE_MIN_SOMPI) return TX_FEE_MIN_SOMPI;
  if (buffered > TX_FEE_MAX_SOMPI) return TX_FEE_MAX_SOMPI;
  return buffered;
}

// ── Platform (treasury) fee ───────────────────────────────────────────────────
// Set TREASURY_ADDRESS to a valid Kaspa address to enable the platform fee.
// Leave empty to disable (no fee output will be added).
const TREASURY_ADDRESS = "kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85";
const PLATFORM_FEE_BPS = 30;               // 0.3 % of send amount
const MIN_PLATFORM_FEE_SOMPI = 100_000n;   // 0.001 KAS floor
const MAX_PLATFORM_FEE_SOMPI = 100_000_000n; // 1 KAS ceiling

/**
 * Calculate the platform fee for a given send amount.
 * Returns null when TREASURY_ADDRESS is not configured.
 */
function calcPlatformFee(amountSompi: bigint): bigint | null {
  if (!TREASURY_ADDRESS) return null;
  const bpsFee = (amountSompi * BigInt(PLATFORM_FEE_BPS)) / 10_000n;
  if (bpsFee < MIN_PLATFORM_FEE_SOMPI) return MIN_PLATFORM_FEE_SOMPI;
  if (bpsFee > MAX_PLATFORM_FEE_SOMPI) return MAX_PLATFORM_FEE_SOMPI;
  return bpsFee;
}

// Lazy-load kaspa-wasm (heavy WASM binary — only when actually sending)
const loadKaspa = loadKaspaWasm;

/**
 * Build a transaction for the given send parameters.
 *
 * Performs coin selection, fee estimation, change calculation, and constructs
 * the PendingTx model. Does NOT sign or broadcast.
 *
 * @param fromAddress  Sender's Kaspa address.
 * @param toAddress    Recipient's Kaspa address.
 * @param amountKas    Amount to send in KAS (will be converted to sompi).
 * @param network      Network identifier.
 * @returns            PendingTx in BUILDING state with inputs, outputs, fee, change.
 */
export async function buildTransaction(
  fromAddress: string,
  toAddress: string,
  amountKas: number,
  network: string,
): Promise<PendingTx> {
  const amountSompi = kasToSompi(amountKas);
  if (amountSompi <= 0n) throw new Error("AMOUNT_TOO_SMALL");

  // Calculate platform fee (null if treasury not configured)
  const platformFee = calcPlatformFee(amountSompi);

  // Total that must be covered by UTXOs (recipient + optional treasury)
  const spendSompi = amountSompi + (platformFee ?? 0n);

  // Output count: recipient + change + optional treasury
  const outputCount = platformFee ? 3 : 2;

  // Get locked UTXOs (inputs already reserved by in-flight txs)
  const lockedKeys = await getLockedUtxoKeys(fromAddress);

  // Fetch or use cached UTXO set
  const utxoSet = await getOrSyncUtxos(fromAddress, network);

  // Estimate fee with N outputs (destination [+ treasury] + change) and 1 input
  // We'll select inputs first with a preliminary fee estimate, then refine.
  const preliminary = applyFeePolicy(await estimateFee(1, outputCount, network));
  const { selected, total } = selectUtxos(
    utxoSet.utxos,
    spendSompi,
    preliminary,
    lockedKeys,
  );

  // Refine fee with actual input count
  const refinedFee = applyFeePolicy(await estimateFee(selected.length, outputCount, network));

  // Re-select with refined fee if coverage changed
  let inputs = selected;
  let inputTotal = total;
  if (total < spendSompi + refinedFee) {
    const refined = selectUtxos(utxoSet.utxos, spendSompi, refinedFee, lockedKeys);
    inputs = refined.selected;
    inputTotal = refined.total;
  }

  const changeAmount = inputTotal - spendSompi - refinedFee;
  if (changeAmount < 0n) throw new Error("INSUFFICIENT_FUNDS");
  const outputs: TxOutput[] = [{ address: toAddress, amount: amountSompi }];

  // Add treasury output when platform fee is active
  if (platformFee && TREASURY_ADDRESS) {
    outputs.push({ address: TREASURY_ADDRESS, amount: platformFee });
  }

  const changeOutput: TxOutput | null =
    changeAmount > 0n ? { address: fromAddress, amount: changeAmount } : null;

  const pendingTx: PendingTx = {
    id: crypto.randomUUID(),
    state: "BUILDING",
    fromAddress,
    network,
    inputs,
    outputs,
    changeOutput,
    fee: refinedFee,
    platformFee: platformFee ?? undefined,
    builtAt: Date.now(),
  };

  return pendingTx;
}

/**
 * Construct the kaspa-wasm Generator and produce a signed-ready transaction.
 * Called by signer.ts after the user confirms in the UI.
 *
 * Returns the generator's pending transaction object (kaspa-wasm type).
 * Throws if the kaspa-wasm API is unavailable or inputs are exhausted.
 */
export async function buildKaspaWasmTx(
  tx: PendingTx,
): Promise<unknown /* PendingTransactionT from kaspa-wasm */> {
  const kaspa = await loadKaspa();

  // Convert internal Utxo model to kaspa-wasm UtxoEntry objects
  // kaspa-wasm v0.13.x UtxoEntry constructor / shape:
  const UtxoEntry = (kaspa as Record<string, unknown>).UtxoEntry as
    | (new (args: unknown) => unknown)
    | undefined;

  // Build entry list — try UtxoEntry class first, fall back to plain object
  const entries = tx.inputs.map((utxo: Utxo) => {
    const entry = {
      address: utxo.address,
      outpoint: { transactionId: utxo.txId, index: utxo.outputIndex },
      amount: utxo.amount,
      scriptPublicKey: {
        version: utxo.scriptVersion,
        scriptPublicKey: utxo.scriptPublicKey,
      },
      blockDaaScore: utxo.blockDaaScore,
      isCoinbase: utxo.isCoinbase,
    };
    if (UtxoEntry) {
      try { return new UtxoEntry(entry); } catch { return entry; }
    }
    return entry;
  });

  // Build payment outputs
  const outputList: Array<Record<string, unknown>> = tx.outputs.map((o: TxOutput) => ({
    address: o.address,
    amount: o.amount,
  }));

  // OP_RETURN output (zero-value, script: 6a<payload>)
  if (tx.opReturnHex) {
    outputList.push({
      value: 0n,
      scriptPublicKey: {
        version: 0,
        scriptPublicKey: `6a${tx.opReturnHex}`,
      },
    });
  }

  // Build generator config
  const generatorConfig: Record<string, unknown> = {
    entries,
    outputs: outputList,
    changeAddress: tx.fromAddress,
    priorityFee: { sompi: tx.fee },
    networkId: tx.network,
  };

  const Generator = (kaspa as Record<string, unknown>).Generator as
    | (new (config: unknown) => { next: () => unknown | null })
    | undefined;

  if (!Generator) {
    throw new Error(
      "WASM_GENERATOR_UNAVAILABLE: kaspa-wasm Generator class not found. " +
      "Ensure kaspa-wasm ≥ 0.13.0 is installed.",
    );
  }

  const generator = new Generator(generatorConfig);
  const pending = generator.next();

  if (!pending) {
    throw new Error("GENERATOR_EMPTY: Generator produced no transaction. Check UTXO availability.");
  }

  return pending;
}

// ── Batch transaction (multi-output) ─────────────────────────────────────────

export interface BatchTxOptions {
  agentJobId?: string;
  opReturnHex?: string;
}

/**
 * Build a multi-output batch transaction.
 * All recipient outputs are included; one treasury output maximum (not per-recipient).
 * Supports optional OP_RETURN receipt anchoring via opReturnHex.
 */
export async function buildBatchTransaction(
  fromAddress: string,
  recipients: Array<{ address: string; amountKas: number }>,
  network: string,
  opts: BatchTxOptions = {},
): Promise<PendingTx> {
  if (!recipients.length) throw new Error("BATCH_EMPTY: at least one recipient required");

  const recipientOutputs: TxOutput[] = recipients.map((r) => ({
    address: r.address,
    amount: kasToSompi(r.amountKas),
  }));

  const totalRecipientSompi = recipientOutputs.reduce((s, o) => s + o.amount, 0n);
  if (totalRecipientSompi <= 0n) throw new Error("AMOUNT_TOO_SMALL");

  // Single platform fee on total batch send (not per-recipient)
  const platformFee = calcPlatformFee(totalRecipientSompi);
  const spendSompi = totalRecipientSompi + (platformFee ?? 0n);

  // Output count: recipients + change + optional treasury + optional OP_RETURN
  const outputCount = recipientOutputs.length
    + 1  // change
    + (platformFee ? 1 : 0)
    + (opts.opReturnHex ? 1 : 0);

  const lockedKeys = await getLockedUtxoKeys(fromAddress);
  const utxoSet = await getOrSyncUtxos(fromAddress, network);

  const preliminary = applyFeePolicy(await estimateFee(1, outputCount, network));
  const { selected, total } = selectUtxos(utxoSet.utxos, spendSompi, preliminary, lockedKeys);

  const refinedFee = applyFeePolicy(await estimateFee(selected.length, outputCount, network));
  let inputs = selected;
  let inputTotal = total;
  if (inputTotal < spendSompi + refinedFee) {
    const refined = selectUtxos(utxoSet.utxos, spendSompi, refinedFee, lockedKeys);
    inputs = refined.selected;
    inputTotal = refined.total;
  }

  const changeAmount = inputTotal - spendSompi - refinedFee;
  if (changeAmount < 0n) throw new Error("INSUFFICIENT_FUNDS");

  const outputs: TxOutput[] = [...recipientOutputs];
  if (platformFee && TREASURY_ADDRESS) {
    outputs.push({ address: TREASURY_ADDRESS, amount: platformFee });
  }

  const changeOutput: TxOutput | null =
    changeAmount > 0n ? { address: fromAddress, amount: changeAmount } : null;

  return {
    id: crypto.randomUUID(),
    state: "BUILDING",
    fromAddress,
    network,
    inputs,
    outputs,
    changeOutput,
    fee: refinedFee,
    platformFee: platformFee ?? undefined,
    builtAt: Date.now(),
    agentJobId: opts.agentJobId,
    opReturnHex: opts.opReturnHex,
  };
}

/**
 * Encode an agent job receipt as a hex string for OP_RETURN anchoring.
 * Format: "FGOS" magic (4) + jobId slice (16 bytes) + status byte + DAA score (8 bytes LE)
 * Total: 29 bytes — well within the 80-byte OP_RETURN limit.
 */
export function encodeAgentReceipt(
  jobId: string,
  status: "ok" | "fail",
  daaScore?: bigint,
): string {
  const magic = Array.from("FGOS").map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  const jobBytes = new TextEncoder().encode(jobId.slice(0, 16));
  const jobHex = Array.from(jobBytes).map((b) => b.toString(16).padStart(2, "0")).join("").padEnd(32, "0");
  const statusByte = status === "ok" ? "01" : "00";
  const score = daaScore ?? 0n;
  const scoreHex = score.toString(16).padStart(16, "0");
  return `${magic}${jobHex}${statusByte}${scoreHex}`;
}
