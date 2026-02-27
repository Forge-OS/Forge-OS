// Kaspa REST API client — typed, retry-capable, circuit-broken.
// Used by UTXO sync, fee estimation, and transaction broadcast.
// Does NOT use kaspa-wasm's WebSocket RPC — the extension uses REST only.
import {
  getCustomKaspaRpc,
  getKaspaRpcProviderPreset,
  type KaspaRpcProviderPreset,
} from "../shared/storage";

// ── Config ────────────────────────────────────────────────────────────────────

const DEFAULT_ENDPOINT_POOLS: Record<string, string[]> = {
  mainnet: ["https://api.kaspa.org"],
  "testnet-10": ["https://api-tn10.kaspa.org"],
  // Keep the official TN11 API as the built-in default.
  // Add extra TN11 mirrors via VITE_KASPA_TN11_API_ENDPOINTS when available.
  "testnet-11": ["https://api-tn11.kaspa.org"],
  // Keep TN12 isolated so operators can tune its endpoint pool independently.
  "testnet-12": ["https://api-tn12.kaspa.org"],
};

function parseEndpointPoolEnv(envKey: string, fallback: string[]): string[] {
  const raw = (import.meta as any)?.env?.[envKey];
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  const parsed = raw
    .split(/[,\s]+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i);
  return parsed.length ? parsed : fallback;
}

export const ENDPOINT_POOLS: Record<string, string[]> = {
  mainnet: parseEndpointPoolEnv("VITE_KASPA_MAINNET_API_ENDPOINTS", DEFAULT_ENDPOINT_POOLS.mainnet),
  "testnet-10": parseEndpointPoolEnv("VITE_KASPA_TN10_API_ENDPOINTS", DEFAULT_ENDPOINT_POOLS["testnet-10"]),
  "testnet-11": parseEndpointPoolEnv("VITE_KASPA_TN11_API_ENDPOINTS", DEFAULT_ENDPOINT_POOLS["testnet-11"]),
  "testnet-12": parseEndpointPoolEnv("VITE_KASPA_TN12_API_ENDPOINTS", DEFAULT_ENDPOINT_POOLS["testnet-12"]),
};

const IGRA_ENDPOINT_POOLS: Record<string, string[]> = {
  mainnet: parseEndpointPoolEnv("VITE_KASPA_IGRA_MAINNET_API_ENDPOINTS", []),
  "testnet-10": parseEndpointPoolEnv("VITE_KASPA_IGRA_TN10_API_ENDPOINTS", []),
  "testnet-11": parseEndpointPoolEnv("VITE_KASPA_IGRA_TN11_API_ENDPOINTS", []),
  "testnet-12": parseEndpointPoolEnv("VITE_KASPA_IGRA_TN12_API_ENDPOINTS", []),
};

const KASPLEX_ENDPOINT_POOLS: Record<string, string[]> = {
  mainnet: parseEndpointPoolEnv("VITE_KASPA_KASPLEX_MAINNET_API_ENDPOINTS", []),
  "testnet-10": parseEndpointPoolEnv("VITE_KASPA_KASPLEX_TN10_API_ENDPOINTS", []),
  "testnet-11": parseEndpointPoolEnv("VITE_KASPA_KASPLEX_TN11_API_ENDPOINTS", []),
  "testnet-12": parseEndpointPoolEnv("VITE_KASPA_KASPLEX_TN12_API_ENDPOINTS", []),
};

export const ENDPOINTS: Record<string, string> = {
  mainnet: ENDPOINT_POOLS.mainnet[0],
  "testnet-10": ENDPOINT_POOLS["testnet-10"][0],
  "testnet-11": ENDPOINT_POOLS["testnet-11"][0],
  "testnet-12": ENDPOINT_POOLS["testnet-12"][0],
};

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_BASE_MS = 600;

function isRetryableHttpStatus(status: number): boolean {
  // Rate-limit and timeout responses can be transient and endpoint-specific.
  return status === 408 || status === 429 || status >= 500;
}

// ── Circuit breaker ───────────────────────────────────────────────────────────

const CB_TRIP_THRESHOLD = 4;  // consecutive failures before open
const CB_RECOVER_MS = 30_000; // half-open after 30 s

type CBState = "closed" | "open" | "half-open";
const _cb: Record<string, { state: CBState; failures: number; openAt: number }> = {};

type EndpointHealth = {
  lastOkAt: number;
  lastFailAt: number;
  consecutiveFails: number;
  lastLatencyMs: number;
  lastStatus: number;
  lastError: string;
};

const _health: Record<string, EndpointHealth> = {};

function getEndpointHealth(base: string): EndpointHealth {
  if (!_health[base]) {
    _health[base] = {
      lastOkAt: 0,
      lastFailAt: 0,
      consecutiveFails: 0,
      lastLatencyMs: 0,
      lastStatus: 0,
      lastError: "",
    };
  }
  return _health[base];
}

function markHealthSuccess(base: string, latencyMs: number, status = 200) {
  const h = getEndpointHealth(base);
  h.lastOkAt = Date.now();
  h.consecutiveFails = 0;
  h.lastLatencyMs = latencyMs;
  h.lastStatus = status;
  h.lastError = "";
}

function markHealthFailure(base: string, error: string, status = 0) {
  const h = getEndpointHealth(base);
  h.lastFailAt = Date.now();
  h.consecutiveFails += 1;
  h.lastStatus = status;
  h.lastError = error;
}

function getCircuitBreaker(base: string) {
  if (!_cb[base]) _cb[base] = { state: "closed", failures: 0, openAt: 0 };
  const cb = _cb[base];
  if (cb.state === "open" && Date.now() - cb.openAt > CB_RECOVER_MS) {
    cb.state = "half-open";
  }
  return cb;
}

function onSuccess(base: string) {
  const cb = _cb[base];
  if (!cb) return;
  cb.failures = 0;
  cb.state = "closed";
}

function onFailure(base: string) {
  const cb = _cb[base];
  if (!cb) return;
  cb.failures++;
  if (cb.failures >= CB_TRIP_THRESHOLD) {
    cb.state = "open";
    cb.openAt = Date.now();
  }
}

export interface KaspaEndpointHealthSnapshot {
  base: string;
  circuit: CBState;
  failures: number;
  lastOkAt: number;
  lastFailAt: number;
  consecutiveFails: number;
  lastLatencyMs: number;
  lastStatus: number;
  lastError: string;
}

export function getKaspaEndpointHealth(network?: string): Record<string, KaspaEndpointHealthSnapshot[]> | KaspaEndpointHealthSnapshot[] {
  const mapNetwork = (net: string): KaspaEndpointHealthSnapshot[] => {
    const pool = ENDPOINT_POOLS[net] ?? ENDPOINT_POOLS.mainnet;
    return pool.map((base) => {
      const cb = getCircuitBreaker(base);
      const h = getEndpointHealth(base);
      return {
        base,
        circuit: cb.state,
        failures: cb.failures,
        lastOkAt: h.lastOkAt,
        lastFailAt: h.lastFailAt,
        consecutiveFails: h.consecutiveFails,
        lastLatencyMs: h.lastLatencyMs,
        lastStatus: h.lastStatus,
        lastError: h.lastError,
      };
    });
  };

  if (network) return mapNetwork(network);
  return {
    mainnet: mapNetwork("mainnet"),
    "testnet-10": mapNetwork("testnet-10"),
    "testnet-11": mapNetwork("testnet-11"),
    "testnet-12": mapNetwork("testnet-12"),
  };
}

function rankEndpointPool(poolInput: string[]): string[] {
  const pool = [...poolInput];
  return pool.sort((a, b) => {
    const cbA = getCircuitBreaker(a);
    const cbB = getCircuitBreaker(b);
    if (cbA.state === "open" && cbB.state !== "open") return 1;
    if (cbB.state === "open" && cbA.state !== "open") return -1;
    const hA = getEndpointHealth(a);
    const hB = getEndpointHealth(b);
    // Prefer recent successes and fewer failures.
    if (hA.lastOkAt !== hB.lastOkAt) return hB.lastOkAt - hA.lastOkAt;
    if (hA.consecutiveFails !== hB.consecutiveFails) return hA.consecutiveFails - hB.consecutiveFails;
    return 0;
  });
}

function resolveProviderPresetPool(network: string, preset: KaspaRpcProviderPreset): string[] {
  const official = ENDPOINT_POOLS[network] ?? ENDPOINT_POOLS.mainnet;

  if (preset === "igra") {
    const pool = IGRA_ENDPOINT_POOLS[network] ?? [];
    return pool.length ? pool : official;
  }

  if (preset === "kasplex") {
    const pool = KASPLEX_ENDPOINT_POOLS[network] ?? [];
    return pool.length ? pool : official;
  }

  // "custom" still falls back to official pool when no custom endpoint is set.
  return official;
}

async function resolveRuntimeEndpointPool(network: string): Promise<string[]> {
  let preset: KaspaRpcProviderPreset = "official";
  try {
    preset = await getKaspaRpcProviderPreset(network);
  } catch {
    preset = "official";
  }

  const fallbackPool = [...resolveProviderPresetPool(network, preset)];
  if (preset !== "custom") return rankEndpointPool(fallbackPool);

  let customEndpoint: string | null = null;
  try {
    customEndpoint = await getCustomKaspaRpc(network);
  } catch {
    customEndpoint = null;
  }

  if (customEndpoint) {
    const filtered = fallbackPool.filter((base) => base !== customEndpoint);
    return rankEndpointPool([customEndpoint, ...filtered]);
  }

  return rankEndpointPool(fallbackPool);
}

// ── Core fetch ────────────────────────────────────────────────────────────────

async function apiFetchFromBase<T>(base: string, path: string, options?: RequestInit): Promise<T> {
  const cb = getCircuitBreaker(base);

  if (cb.state === "open") {
    throw new KaspaApiError(`Circuit open for ${base} — backing off`, 503);
  }

  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_BASE_MS * 2 ** (attempt - 1)));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const startedAt = Date.now();

    try {
      const res = await fetch(`${base}${path}`, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        markHealthFailure(base, `HTTP ${res.status}`, res.status);
        throw new KaspaApiError(`HTTP ${res.status}: ${body.slice(0, 120)}`, res.status);
      }

      const data = (await res.json()) as T;
      onSuccess(base);
      markHealthSuccess(base, Date.now() - startedAt, res.status);
      return data;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof KaspaApiError && !isRetryableHttpStatus(err.status)) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      markHealthFailure(base, msg);
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }

  onFailure(base);
  throw lastErr ?? new KaspaApiError("Unknown API error", 0);
}

async function apiFetch<T>(
  network: string,
  path: string,
  options?: RequestInit,
): Promise<T> {
  const pool = await resolveRuntimeEndpointPool(network);
  let lastErr: Error | null = null;

  for (const base of pool) {
    try {
      return await apiFetchFromBase<T>(base, path, options);
    } catch (err) {
      // Keep fail-closed behavior for non-retryable 4xx request errors.
      if (err instanceof KaspaApiError && !isRetryableHttpStatus(err.status)) throw err;
      lastErr = err instanceof Error ? err : new Error(String(err));
      // Try the next endpoint in the pool.
    }
  }

  throw lastErr ?? new KaspaApiError("Unknown API error", 0);
}

// ── Error type ────────────────────────────────────────────────────────────────

export class KaspaApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "KaspaApiError";
  }
}

// ── Typed API shapes ──────────────────────────────────────────────────────────

export interface KaspaUtxoResponse {
  address: string;
  outpoint: { transactionId: string; index: number };
  utxoEntry: {
    amount: string;           // bigint as string
    scriptPublicKey: { version: number; scriptPublicKey: string };
    blockDaaScore: string;    // bigint as string
    isCoinbase: boolean;
  };
}

export interface KaspaTransactionResponse {
  transactionId: string;
  acceptingBlockHash: string | null;
  inputs: unknown[];
  outputs: unknown[];
}

export interface KaspaFeeEstimate {
  priorityBucket: { feerate: number; estimatedSeconds: number };
  normalBuckets: Array<{ feerate: number; estimatedSeconds: number }>;
  lowBuckets: Array<{ feerate: number; estimatedSeconds: number }>;
}

export interface KaspaDagInfo {
  networkName: string;
  blockCount: string;
  headerCount: string;
  /** Monotonically increasing virtual DAA score — increments ~10/s on mainnet 10-BPS. */
  virtualDaaScore: string;
  difficulty: number;
}

// ── Network BPS constants (theoretical target block rate per network) ──────────
export const NETWORK_BPS: Record<string, number> = {
  mainnet:       10,
  "testnet-10":  10,
  "testnet-11":  32,
  "testnet-12":  10,
};

// ── Public methods ────────────────────────────────────────────────────────────

/** Fetch all UTXOs for an address. */
export async function fetchUtxos(
  address: string,
  network = "mainnet",
): Promise<KaspaUtxoResponse[]> {
  return apiFetch<KaspaUtxoResponse[]>(
    network,
    `/addresses/${encodeURIComponent(address)}/utxos`,
  );
}

/** Fetch confirmed KAS balance in sompi. */
export async function fetchBalance(
  address: string,
  network = "mainnet",
): Promise<bigint> {
  const data = await apiFetch<{ balance: string | number }>(
    network,
    `/addresses/${encodeURIComponent(address)}/balance`,
  );
  return BigInt(data?.balance ?? 0);
}

/** Fetch current KAS/USD price. Returns 0 on failure (non-critical). */
export async function fetchKasPrice(network = "mainnet"): Promise<number> {
  try {
    const data = await apiFetch<{ price: number }>(
      network,
      `/info/price?stringOnly=false`,
    );
    return data?.price ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Fetch fee estimate from the network.
 * Returns feerate in sompi/gram (mass unit).
 * Kaspa's minimum feerate is ~1 sompi/gram.
 */
export async function fetchFeeEstimate(network = "mainnet"): Promise<number> {
  try {
    const data = await apiFetch<KaspaFeeEstimate>(network, `/info/fee-estimate`);
    return data?.priorityBucket?.feerate ?? 1;
  } catch {
    return 1; // fallback to minimum
  }
}

/**
 * Estimate transaction fee given input/output counts.
 * Uses the network's current feerate multiplied by estimated mass.
 * Kaspa mass ≈ 239 + 142 * inputs + 51 * outputs (simplified Rust formula).
 */
export async function estimateFee(
  inputCount: number,
  outputCount: number,
  network = "mainnet",
): Promise<bigint> {
  const feerate = await fetchFeeEstimate(network);
  const mass = 239 + 142 * inputCount + 51 * outputCount;
  // Minimum fee = mass * feerate, but always at least 1000 sompi (safety floor)
  return BigInt(Math.max(Math.ceil(mass * feerate), 1_000));
}

/**
 * Broadcast a signed transaction.
 * Expects the Kaspa REST API format: { "transaction": { ... } }
 * Returns the transaction ID.
 */
export async function broadcastTx(
  txPayload: object,
  network = "mainnet",
): Promise<string> {
  const data = await apiFetch<{ transactionId?: string; txid?: string }>(
    network,
    `/transactions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(txPayload),
    },
  );
  const txId = data?.transactionId ?? data?.txid ?? "";
  if (!txId) throw new KaspaApiError("Broadcast succeeded but no txId returned", 200);
  return txId;
}

/**
 * Fetch a transaction by ID. Returns null if not found.
 * Used for confirmation polling.
 */
export async function fetchTransaction(
  txId: string,
  network = "mainnet",
): Promise<KaspaTransactionResponse | null> {
  try {
    return await apiFetch<KaspaTransactionResponse>(
      network,
      `/transactions/${txId}`,
    );
  } catch (err) {
    if (err instanceof KaspaApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Fetch live BlockDAG info — virtualDaaScore, blockCount, difficulty.
 * The virtualDaaScore advances at ~10/s on mainnet (10 BPS).
 * Returns null on failure (non-critical display data).
 */
export async function fetchDagInfo(network = "mainnet"): Promise<KaspaDagInfo | null> {
  try {
    return await apiFetch<KaspaDagInfo>(network, `/info/blockdag`);
  } catch {
    return null;
  }
}

/**
 * Active health probe for the endpoint pool of a network.
 * Useful for diagnostics and UI warnings when a testnet API is flaky.
 */
export async function probeKaspaEndpointPool(
  network = "mainnet",
): Promise<KaspaEndpointHealthSnapshot[]> {
  const pool = await resolveRuntimeEndpointPool(network);

  await Promise.all(pool.map(async (base) => {
    try {
      await apiFetchFromBase<{ virtualDaaScore?: string }>(base, `/info/blockdag`);
    } catch {
      // Health is already recorded by apiFetchFromBase. Keep probing best-effort.
    }
  }));

  return getKaspaEndpointHealth(network) as KaspaEndpointHealthSnapshot[];
}
