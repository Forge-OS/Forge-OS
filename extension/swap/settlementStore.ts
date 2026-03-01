import type { SwapSettlementRecord, SwapSettlementState } from "./settlement";

const SETTLEMENT_KEY = "forgeos.swap.settlements.v1";
const SETTLEMENT_LIMIT = 200;

function localStore(): chrome.storage.LocalStorageArea {
  return chrome.storage.local;
}

async function readRaw(): Promise<unknown> {
  return new Promise((resolve) => {
    localStore().get(SETTLEMENT_KEY, (result) => resolve(result?.[SETTLEMENT_KEY] ?? null));
  });
}

async function writeRaw(value: unknown): Promise<void> {
  return new Promise((resolve) => {
    localStore().set({ [SETTLEMENT_KEY]: value }, resolve);
  });
}

function isSwapSettlementState(value: unknown): value is SwapSettlementState {
  return [
    "REQUESTED",
    "QUOTED",
    "SIGNED",
    "SUBMITTED",
    "PENDING_CONFIRMATION",
    "CONFIRMED",
    "FAILED_REVERT",
    "FAILED_TIMEOUT",
    "FAILED_BRIDGE",
  ].includes(String(value));
}

function normalizeRecord(value: unknown): SwapSettlementRecord | null {
  const v = value as Record<string, unknown> | null;
  if (!v) return null;
  const id = typeof v.id === "string" ? v.id : "";
  const routeSource = typeof v.routeSource === "string" ? v.routeSource : "";
  const state = v.state;
  if (!id || !isSwapSettlementState(state)) return null;
  if (routeSource !== "blocked" && routeSource !== "kaspa_native" && routeSource !== "evm_0x") return null;
  return {
    id,
    routeSource,
    state,
    network: typeof v.network === "string" && v.network ? v.network : "mainnet",
    createdAt: typeof v.createdAt === "number" && Number.isFinite(v.createdAt) ? v.createdAt : Date.now(),
    updatedAt: typeof v.updatedAt === "number" && Number.isFinite(v.updatedAt) ? v.updatedAt : Date.now(),
    txHash: typeof v.txHash === "string" ? v.txHash : null,
    bridgeTransferId: typeof v.bridgeTransferId === "string" ? v.bridgeTransferId : null,
    confirmations: typeof v.confirmations === "number" && Number.isFinite(v.confirmations) ? v.confirmations : 0,
    error: typeof v.error === "string" ? v.error : null,
  };
}

function normalizeCollection(raw: unknown): SwapSettlementRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: SwapSettlementRecord[] = [];
  for (const item of raw) {
    const record = normalizeRecord(item);
    if (record) out.push(record);
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out.slice(0, SETTLEMENT_LIMIT);
}

export async function listSwapSettlements(): Promise<SwapSettlementRecord[]> {
  const raw = await readRaw();
  return normalizeCollection(raw);
}

export async function getSwapSettlement(id: string): Promise<SwapSettlementRecord | null> {
  const records = await listSwapSettlements();
  return records.find((r) => r.id === id) ?? null;
}

export async function upsertSwapSettlement(record: SwapSettlementRecord): Promise<void> {
  const records = await listSwapSettlements();
  const next = [record, ...records.filter((r) => r.id !== record.id)]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, SETTLEMENT_LIMIT);
  await writeRaw(next);
}

export async function removeSwapSettlement(id: string): Promise<void> {
  const records = await listSwapSettlements();
  const next = records.filter((r) => r.id !== id);
  await writeRaw(next);
}

export function isPendingSettlement(record: SwapSettlementRecord): boolean {
  return record.state === "SUBMITTED" || record.state === "PENDING_CONFIRMATION";
}
