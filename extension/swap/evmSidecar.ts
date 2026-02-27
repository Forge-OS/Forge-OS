import { SWAP_CONFIG } from "./types";

const EVM_SIDECAR_SESSION_KEY = "forgeos.swap.evm.sidecar.v1";

export interface EvmSidecarSession {
  walletType: "metamask";
  address: string;
  chainId: number;
  connectedAt: number;
  updatedAt: number;
}

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normalizeAddress(value: unknown): string {
  if (typeof value !== "string") return "";
  const v = value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(v)) return "";
  return v;
}

function parseChainId(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (!v) return 0;
    if (v.startsWith("0x")) {
      const n = Number.parseInt(v.slice(2), 16);
      return Number.isInteger(n) && n > 0 ? n : 0;
    }
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : 0;
  }
  return 0;
}

function localStoreAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeSession(raw: unknown): EvmSidecarSession | null {
  const v = raw as Record<string, unknown> | null;
  if (!v) return null;
  const address = normalizeAddress(v.address);
  const chainId = parseChainId(v.chainId);
  const walletType = v.walletType === "metamask" ? "metamask" : null;
  const connectedAt = typeof v.connectedAt === "number" && Number.isFinite(v.connectedAt) ? v.connectedAt : 0;
  const updatedAt = typeof v.updatedAt === "number" && Number.isFinite(v.updatedAt) ? v.updatedAt : connectedAt;
  if (!walletType || !address || chainId <= 0) return null;
  return { walletType, address, chainId, connectedAt: connectedAt || Date.now(), updatedAt: updatedAt || Date.now() };
}

export function getEvmSidecarSession(): EvmSidecarSession | null {
  if (!localStoreAvailable()) return null;
  const parsed = parseJson<unknown>(window.localStorage.getItem(EVM_SIDECAR_SESSION_KEY));
  return normalizeSession(parsed);
}

export function saveEvmSidecarSession(
  session: Omit<EvmSidecarSession, "connectedAt" | "updatedAt"> & Partial<Pick<EvmSidecarSession, "connectedAt" | "updatedAt">>,
): EvmSidecarSession {
  const now = Date.now();
  const normalized = normalizeSession({
    ...session,
    connectedAt: session.connectedAt ?? now,
    updatedAt: session.updatedAt ?? now,
  });
  if (!normalized) {
    throw new Error("EVM_SIDECAR_INVALID_SESSION");
  }
  if (localStoreAvailable()) {
    window.localStorage.setItem(EVM_SIDECAR_SESSION_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

export function clearEvmSidecarSession(): void {
  if (!localStoreAvailable()) return;
  window.localStorage.removeItem(EVM_SIDECAR_SESSION_KEY);
}

export function isEvmChainAllowed(chainId: number): boolean {
  return SWAP_CONFIG.evmChainIdAllowlist.includes(chainId);
}

export function getEip1193Provider(): Eip1193Provider | null {
  const p = (globalThis as any)?.ethereum;
  if (p && typeof p.request === "function") return p as Eip1193Provider;
  return null;
}

export async function connectMetaMaskSidecar(): Promise<EvmSidecarSession> {
  const provider = getEip1193Provider();
  if (!provider) {
    throw new Error("EVM_SIDECAR_UNAVAILABLE: No injected EVM provider found.");
  }

  const accountsRaw = await provider.request({ method: "eth_requestAccounts" });
  const accounts = Array.isArray(accountsRaw) ? accountsRaw : [];
  const address = normalizeAddress(accounts[0]);
  if (!address) {
    throw new Error("EVM_SIDECAR_CONNECT_FAILED: No EVM account returned.");
  }

  const chainRaw = await provider.request({ method: "eth_chainId" });
  const chainId = parseChainId(chainRaw);
  if (chainId <= 0) {
    throw new Error("EVM_SIDECAR_CHAIN_INVALID: Could not determine chain ID.");
  }
  if (!isEvmChainAllowed(chainId)) {
    throw new Error(`EVM_SIDECAR_CHAIN_NOT_ALLOWED: chainId ${chainId} not allowed.`);
  }

  return saveEvmSidecarSession({
    walletType: "metamask",
    address,
    chainId,
  });
}

export interface EvmTransactionRequest {
  from: string;
  to: string;
  data: string;
  value?: string;
}

export async function sendEvmTransaction(tx: EvmTransactionRequest): Promise<string> {
  const provider = getEip1193Provider();
  if (!provider) {
    throw new Error("EVM_SIDECAR_UNAVAILABLE: No injected EVM provider found.");
  }
  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [tx],
  });
  if (typeof hash !== "string" || !hash.startsWith("0x")) {
    throw new Error("EVM_TX_HASH_INVALID");
  }
  return hash;
}

export async function fetchEvmTransactionReceipt(
  txHash: string,
): Promise<Record<string, unknown> | null> {
  const provider = getEip1193Provider();
  if (!provider) return null;
  const receipt = await provider.request({
    method: "eth_getTransactionReceipt",
    params: [txHash],
  });
  if (!receipt || typeof receipt !== "object") return null;
  return receipt as Record<string, unknown>;
}

export async function fetchEvmBlockNumber(): Promise<number | null> {
  const provider = getEip1193Provider();
  if (!provider) return null;
  const value = await provider.request({ method: "eth_blockNumber" });
  const block = parseChainId(value);
  return block > 0 ? block : null;
}

export function extractReceiptStatus(receipt: Record<string, unknown>): "success" | "revert" | "unknown" {
  const status = receipt.status;
  if (typeof status === "number") return status === 1 ? "success" : "revert";
  if (typeof status === "string") {
    const v = status.trim().toLowerCase();
    if (v === "0x1" || v === "1") return "success";
    if (v === "0x0" || v === "0") return "revert";
  }
  return "unknown";
}

export function extractReceiptBlockNumber(receipt: Record<string, unknown>): number | null {
  return parseChainId(receipt.blockNumber);
}
