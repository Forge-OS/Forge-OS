import type { SwapRouteSource } from "./types";

export type SwapSettlementState =
  | "REQUESTED"
  | "QUOTED"
  | "SIGNED"
  | "SUBMITTED"
  | "PENDING_CONFIRMATION"
  | "CONFIRMED"
  | "FAILED_REVERT"
  | "FAILED_TIMEOUT"
  | "FAILED_BRIDGE";

export interface SwapSettlementRecord {
  id: string;
  routeSource: SwapRouteSource;
  state: SwapSettlementState;
  network: string;
  createdAt: number;
  updatedAt: number;
  txHash: string | null;
  bridgeTransferId: string | null;
  confirmations: number;
  error: string | null;
}

const ALLOWED_NEXT: Record<SwapSettlementState, SwapSettlementState[]> = {
  REQUESTED: ["QUOTED", "FAILED_TIMEOUT"],
  QUOTED: ["SIGNED", "FAILED_TIMEOUT", "FAILED_BRIDGE"],
  SIGNED: ["SUBMITTED", "FAILED_TIMEOUT", "FAILED_BRIDGE"],
  SUBMITTED: ["SUBMITTED", "PENDING_CONFIRMATION", "CONFIRMED", "FAILED_REVERT", "FAILED_TIMEOUT"],
  PENDING_CONFIRMATION: ["PENDING_CONFIRMATION", "CONFIRMED", "FAILED_REVERT", "FAILED_TIMEOUT", "FAILED_BRIDGE"],
  CONFIRMED: [],
  FAILED_REVERT: [],
  FAILED_TIMEOUT: [],
  FAILED_BRIDGE: [],
};

export function createSwapSettlementRecord(
  id: string,
  routeSource: SwapRouteSource,
  network: string = "mainnet",
  now: number = Date.now(),
): SwapSettlementRecord {
  return {
    id,
    routeSource,
    state: "REQUESTED",
    network,
    createdAt: now,
    updatedAt: now,
    txHash: null,
    bridgeTransferId: null,
    confirmations: 0,
    error: null,
  };
}

export function advanceSwapSettlement(
  record: SwapSettlementRecord,
  next: SwapSettlementState,
  patch: Partial<Pick<SwapSettlementRecord, "txHash" | "bridgeTransferId" | "confirmations" | "error">> = {},
  now: number = Date.now(),
): SwapSettlementRecord {
  if (!ALLOWED_NEXT[record.state].includes(next)) {
    throw new Error(`INVALID_SETTLEMENT_TRANSITION: ${record.state} -> ${next}`);
  }
  return {
    ...record,
    ...patch,
    state: next,
    updatedAt: now,
  };
}
