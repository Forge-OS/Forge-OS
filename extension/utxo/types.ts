// UTXO data model — internal representation of the Kaspa UTXO set.
// All amounts in sompi (bigint). 1 KAS = 100_000_000 sompi.

export const SOMPI_PER_KAS = 100_000_000n;

/**
 * Script classification used by send-path policy.
 * - standard: normal pay-to-pubkey outputs this wallet can spend directly.
 * - covenant: script-constrained outputs that require covenant-specific spend logic.
 */
export type UtxoScriptClass = "standard" | "covenant";

export interface Utxo {
  txId: string;
  outputIndex: number;
  address: string;
  amount: bigint;           // sompi
  scriptPublicKey: string;  // hex-encoded script
  scriptVersion: number;
  scriptClass: UtxoScriptClass;
  blockDaaScore: bigint;
  isCoinbase: boolean;
}

/** Live UTXO set + derived balances for one address. */
export interface UtxoSet {
  address: string;
  utxos: Utxo[];
  confirmedBalance: bigint;  // sum of all confirmed UTXOs
  pendingOutbound: bigint;   // locked by in-flight outbound txs
  lastSyncAt: number;        // Unix ms
}

/** UTXO selected for spending in a transaction. */
export interface SelectedUtxo extends Utxo {
  /** Accumulated value at the time of selection (for change calculation). */
  runningTotal: bigint;
}
