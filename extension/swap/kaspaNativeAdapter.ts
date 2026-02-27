import { isKaspaAddress } from "../../src/helpers";
import type { SwapQuote, SwapRequest } from "./types";

const ENV = (import.meta as any)?.env ?? {};

const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_QUOTE_PATH = "/quote";
const DEFAULT_EXECUTE_PATH = "/execute";
const DEFAULT_STATUS_PATH = "/status";

type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

interface FetchJsonInit {
  method: "GET" | "POST";
  body?: Record<string, JsonValue>;
  timeoutMs?: number;
}

interface KaspaNativeQuoteApiResponse {
  quoteId?: unknown;
  amountOut?: unknown;
  minAmountOut?: unknown;
  feeAmount?: unknown;
  fee?: unknown;
  priceImpactBps?: unknown;
  priceImpact?: unknown;
  route?: unknown;
  validUntil?: unknown;
  settlementAddress?: unknown;
}

interface KaspaNativeStatusApiResponse {
  state?: unknown;
  status?: unknown;
  confirmations?: unknown;
  error?: unknown;
  txId?: unknown;
  settlementTxId?: unknown;
}

export interface KaspaNativeQuoteMeta {
  quoteId: string;
  settlementAddress: string;
}

export interface KaspaNativeExecutionStatus {
  state: "pending" | "confirmed" | "failed";
  confirmations: number;
  error: string | null;
  settlementTxId: string | null;
}

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number(ENV?.[name]);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function readStringEnv(name: string, fallback: string): string {
  const raw = String(ENV?.[name] ?? "").trim();
  return raw || fallback;
}

const REQUEST_TIMEOUT_MS = readIntEnv(
  "VITE_SWAP_KASPA_NATIVE_TIMEOUT_MS",
  DEFAULT_REQUEST_TIMEOUT_MS,
  1_000,
  60_000,
);
const QUOTE_PATH = readStringEnv("VITE_SWAP_KASPA_NATIVE_QUOTE_PATH", DEFAULT_QUOTE_PATH);
const EXECUTE_PATH = readStringEnv("VITE_SWAP_KASPA_NATIVE_EXECUTE_PATH", DEFAULT_EXECUTE_PATH);
const STATUS_PATH = readStringEnv("VITE_SWAP_KASPA_NATIVE_STATUS_PATH", DEFAULT_STATUS_PATH);

function normalizeEndpointBase(endpoint: string): string {
  return String(endpoint || "").trim().replace(/\/+$/, "");
}

function normalizeApiPath(path: string): string {
  const v = String(path || "").trim();
  if (!v) return "/";
  return v.startsWith("/") ? v : `/${v}`;
}

function buildUrl(base: string, path: string): string {
  const normalizedBase = normalizeEndpointBase(base);
  if (!normalizedBase) throw new Error("KASPA_NATIVE_ENDPOINT_MISSING");
  return `${normalizedBase}${normalizeApiPath(path)}`;
}

async function fetchJson(
  url: string,
  init: FetchJsonInit,
): Promise<{ status: number; data: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: init.method,
      headers: { "Content-Type": "application/json" },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`KASPA_NATIVE_HTTP_${res.status}: invalid JSON response`);
      }
    }
    if (!res.ok) {
      const msg = typeof (data as any)?.error === "string"
        ? (data as any).error
        : `HTTP ${res.status}`;
      throw new Error(`KASPA_NATIVE_HTTP_${res.status}: ${msg}`);
    }
    return { status: res.status, data };
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      throw new Error("KASPA_NATIVE_TIMEOUT: request timed out");
    }
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
  }
}

function asDigits(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return String(Math.floor(value));
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return value.trim();
  return "";
}

function asPositiveBigInt(value: unknown, field: string): bigint {
  const digits = asDigits(value);
  if (!digits) throw new Error(`KASPA_NATIVE_QUOTE_INVALID: "${field}" must be an integer string`);
  const out = BigInt(digits);
  if (out < 0n) throw new Error(`KASPA_NATIVE_QUOTE_INVALID: "${field}" must be >= 0`);
  return out;
}

function asFiniteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function parsePriceImpactRatio(raw: KaspaNativeQuoteApiResponse): number {
  const bps = asFiniteNumber(raw.priceImpactBps);
  if (bps !== null && bps >= 0) return bps / 10_000;

  const ratio = asFiniteNumber(raw.priceImpact);
  if (ratio !== null && ratio >= 0 && ratio <= 1) return ratio;

  throw new Error("KASPA_NATIVE_QUOTE_INVALID: missing price impact");
}

function parseRoute(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = raw
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  return out.length ? out : [];
}

function expectedPrefixForNetwork(network: string): string {
  return network === "mainnet" ? "kaspa:" : "kaspatest:";
}

function assertSettlementAddress(address: string, network: string): void {
  const normalized = String(address || "").trim().toLowerCase();
  if (!isKaspaAddress(normalized)) {
    throw new Error("KASPA_NATIVE_QUOTE_INVALID: settlement address is invalid");
  }
  const expected = expectedPrefixForNetwork(network);
  if (!normalized.startsWith(expected)) {
    throw new Error("KASPA_NATIVE_QUOTE_INVALID: settlement address network mismatch");
  }
}

function parseQuoteResponse(
  rawValue: unknown,
  req: SwapRequest,
  endpoint: string,
  network: string,
): SwapQuote {
  const raw = (rawValue ?? {}) as KaspaNativeQuoteApiResponse;
  const quoteId = typeof raw.quoteId === "string" ? raw.quoteId.trim() : "";
  if (!quoteId) throw new Error("KASPA_NATIVE_QUOTE_INVALID: missing quoteId");

  const settlementAddress =
    typeof raw.settlementAddress === "string" ? raw.settlementAddress.trim() : "";
  if (!settlementAddress) {
    throw new Error("KASPA_NATIVE_QUOTE_INVALID: missing settlementAddress");
  }
  assertSettlementAddress(settlementAddress, network);

  const amountOut = asPositiveBigInt(raw.minAmountOut ?? raw.amountOut, "amountOut");
  const fee = asPositiveBigInt(raw.feeAmount ?? raw.fee ?? "0", "feeAmount");
  const priceImpact = parsePriceImpactRatio(raw);
  const route = parseRoute(raw.route);
  const validUntil = asFiniteNumber(raw.validUntil);

  if (validUntil === null || validUntil <= Date.now()) {
    throw new Error("KASPA_NATIVE_QUOTE_INVALID: quote is missing or expired");
  }
  if (route.length === 0) {
    throw new Error("KASPA_NATIVE_QUOTE_INVALID: missing route");
  }

  return {
    tokenIn: req.tokenIn,
    tokenOut: req.tokenOut,
    amountIn: req.amountIn,
    amountOut,
    priceImpact,
    fee,
    route,
    validUntil,
    dexEndpoint: endpoint,
    routeSource: "kaspa_native",
    rawQuote: {
      ...raw,
      quoteId,
      settlementAddress,
      network,
    },
  };
}

export function extractKaspaNativeQuoteMeta(quote: SwapQuote): KaspaNativeQuoteMeta {
  const raw = (quote.rawQuote ?? {}) as Record<string, unknown>;
  const quoteId = typeof raw.quoteId === "string" ? raw.quoteId.trim() : "";
  const settlementAddress = typeof raw.settlementAddress === "string"
    ? raw.settlementAddress.trim()
    : "";
  if (!quoteId || !settlementAddress) {
    throw new Error("KASPA_NATIVE_QUOTE_META_INVALID");
  }
  return { quoteId, settlementAddress };
}

export async function fetchKaspaNativeQuote(
  req: SwapRequest,
  args: { endpoint: string; network: string; walletAddress: string },
): Promise<SwapQuote> {
  const url = buildUrl(args.endpoint, QUOTE_PATH);
  const body: Record<string, JsonValue> = {
    tokenIn: req.tokenIn,
    tokenOut: req.tokenOut,
    amountIn: req.amountIn.toString(),
    slippageBps: req.slippageBps,
    network: args.network,
    walletAddress: args.walletAddress,
  };
  const { data } = await fetchJson(url, { method: "POST", body });
  return parseQuoteResponse(data, req, normalizeEndpointBase(args.endpoint), args.network);
}

export async function submitKaspaNativeExecution(
  args: {
    endpoint: string;
    network: string;
    quoteId: string;
    depositTxId: string;
    walletAddress: string;
    amountIn: bigint;
  },
): Promise<void> {
  const url = buildUrl(args.endpoint, EXECUTE_PATH);
  const body: Record<string, JsonValue> = {
    quoteId: args.quoteId,
    network: args.network,
    depositTxId: args.depositTxId,
    walletAddress: args.walletAddress,
    amountIn: args.amountIn.toString(),
  };
  const { data } = await fetchJson(url, { method: "POST", body });
  const raw = (data ?? {}) as Record<string, unknown>;
  if (raw.accepted === false) {
    throw new Error(
      typeof raw.error === "string" ? raw.error : "KASPA_NATIVE_EXECUTION_REJECTED",
    );
  }
  const state = typeof raw.state === "string" ? raw.state.toLowerCase().trim() : "";
  if (["failed", "rejected", "error"].includes(state)) {
    throw new Error(
      typeof raw.error === "string" ? raw.error : `KASPA_NATIVE_EXECUTION_${state.toUpperCase()}`,
    );
  }
}

function mapStatusState(raw: string): "pending" | "confirmed" | "failed" {
  const state = raw.toLowerCase().trim();
  if (["confirmed", "completed", "success", "settled"].includes(state)) return "confirmed";
  if (["failed", "reverted", "rejected", "expired", "error"].includes(state)) return "failed";
  return "pending";
}

export async function fetchKaspaNativeExecutionStatus(
  args: { endpoint: string; network: string; quoteId: string; depositTxId: string },
): Promise<KaspaNativeExecutionStatus> {
  const base = buildUrl(args.endpoint, STATUS_PATH);
  const params = new URLSearchParams({
    quoteId: args.quoteId,
    depositTxId: args.depositTxId,
    network: args.network,
  });
  const url = `${base}?${params.toString()}`;
  try {
    const { status, data } = await fetchJson(url, { method: "GET" });
    if (status === 404) {
      return { state: "pending", confirmations: 0, error: null, settlementTxId: null };
    }
    const raw = (data ?? {}) as KaspaNativeStatusApiResponse;
    const stateRaw = String(raw.state ?? raw.status ?? "pending");
    const state = mapStatusState(stateRaw);
    const confirmations = Math.max(0, Math.floor(asFiniteNumber(raw.confirmations) ?? 0));
    const error = typeof raw.error === "string" ? raw.error : null;
    const settlementTxId = typeof raw.settlementTxId === "string"
      ? raw.settlementTxId
      : (typeof raw.txId === "string" ? raw.txId : null);
    return { state, confirmations, error, settlementTxId };
  } catch (err) {
    if (String((err as Error)?.message || "").includes("HTTP 404")) {
      return { state: "pending", confirmations: 0, error: null, settlementTxId: null };
    }
    throw err;
  }
}
