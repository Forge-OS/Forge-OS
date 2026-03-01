// Transaction pipeline types.
// All amounts in sompi (bigint). Never use floating-point for amounts.

import type { Utxo } from "../utxo/types";

export type TxState =
  | "BUILDING"           // Inputs selected, fee estimated
  | "DRY_RUN_OK"         // All 5 checks passed
  | "DRY_RUN_FAIL"       // At least one check failed
  | "SIGNED"             // kaspa-wasm signed, ready to broadcast
  | "BROADCASTING"       // Submitted to REST API
  | "CONFIRMING"         // txId confirmed, polling for acceptance
  | "CONFIRMED"          // Accepted into BlockDAG
  | "FAILED"             // Terminal failure
  | "CANCELLED";         // User cancelled at confirmation screen

export interface TxOutput {
  address: string;
  amount: bigint;  // sompi
}

export interface DryRunResult {
  valid: boolean;
  estimatedFee: bigint;      // sompi
  changeAmount: bigint;      // sompi, may be 0
  errors: string[];
}

/**
 * A pending transaction tracked through the full pipeline.
 * Persisted to chrome.storage.local so it survives popup close.
 */
export interface PendingTx {
  /** UUID — used as idempotency key. Never reuse. */
  id: string;
  state: TxState;

  // Parties
  fromAddress: string;
  network: string;

  // Inputs (UTXOs being spent)
  inputs: Utxo[];

  // Intended outputs (NOT including change)
  outputs: TxOutput[];

  // Change back to self
  changeOutput: TxOutput | null;

  // Fee
  fee: bigint;
  /** Optional platform fee routed to treasury address (sompi). Undefined when treasury is unconfigured. */
  platformFee?: bigint;

  // Timing
  builtAt: number;        // Unix ms
  signedAt?: number;
  broadcastAt?: number;
  confirmedAt?: number;

  // Result
  txId?: string;          // Set after broadcast
  confirmations?: number; // Set during polling
  acceptingBlockHash?: string | null;

  // Receipt reconciliation (backend-aware)
  receiptCheckedAt?: number;
  receiptProbeAttempts?: number;
  receiptSourceBackend?: "local" | "remote";
  receiptSourceReason?: string;
  receiptSourceEndpoint?: string | null;

  // Error (if state === FAILED)
  error?: string;

  // Serialised signed transaction (hex or JSON string) for broadcast
  // Cleared after confirmation to reduce storage size
  signedTxPayload?: string;

  // Optional agent job identifier (for OP_RETURN receipt anchoring)
  agentJobId?: string;
  // Optional OP_RETURN data hex (0-byte-value output, max 80 bytes payload)
  opReturnHex?: string;
}

// Storage key for pending tx list
export const PENDING_TX_STORAGE_KEY = "forgeos.pending.txs.v1";
