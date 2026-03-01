// Kaspa WebSocket subscription module (C2)
//
// Wraps kaspa-wasm RpcClient to provide a singleton WebSocket connection
// per network, with UTXO-change and DAA-score subscriptions.
//
// Reconnects automatically with exponential backoff on disconnect.
// Falls back to the existing REST polling when WS is unavailable.

import { loadKaspaWasm } from "../../src/wallet/kaspaWasmLoader";
import { invalidateEndpointPoolCache } from "./kaspaClient";

const ENV = (import.meta as any)?.env ?? {};

function getWsUrl(network: string): string {
  if (network === "mainnet") {
    return ENV.VITE_KAS_WS_URL_MAINNET || ENV.VITE_KAS_WS_URL || "wss://api.kaspa.org/ws";
  }
  if (network === "testnet-10") {
    return ENV.VITE_KAS_WS_URL_TESTNET || "wss://api-tn10.kaspa.org/ws";
  }
  if (network === "testnet-11") {
    return ENV.VITE_KAS_WS_URL_TESTNET || "wss://api-tn11.kaspa.org/ws";
  }
  return ENV.VITE_KAS_WS_URL || "wss://api.kaspa.org/ws";
}

export type WsConnectionState = "disconnected" | "connecting" | "connected" | "error";

// ── Singleton state ───────────────────────────────────────────────────────────

let _client: unknown = null;
let _activeNetwork: string | null = null;
let _state: WsConnectionState = "disconnected";
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _reconnectDelay = 5_000;

const _utxoCallbacks: Map<string, Set<() => void>> = new Map();
const _daaCallbacks: Set<(score: bigint) => void> = new Set();
const _subscribedAddresses: Set<string> = new Set();

// ── Internal helpers ──────────────────────────────────────────────────────────

function setState(s: WsConnectionState): void {
  _state = s;
}

function scheduleReconnect(network: string): void {
  if (_reconnectTimer) return;
  _reconnectTimer = setTimeout(async () => {
    _reconnectTimer = null;
    await connectKaspaWs(network).catch(() => {});
  }, _reconnectDelay);
  _reconnectDelay = Math.min(_reconnectDelay * 2, 60_000); // cap at 60s
}

function resetBackoff(): void {
  _reconnectDelay = 5_000;
}

async function resubscribeAll(): Promise<void> {
  if (!_client || _state !== "connected") return;
  const rpc = _client as Record<string, (arg?: unknown) => Promise<void>>;

  // DAA score subscription
  try {
    await rpc.subscribeVirtualDaaScoreChanged?.();
  } catch { /* non-fatal */ }

  // UTXO subscriptions
  for (const address of _subscribedAddresses) {
    try {
      await rpc.subscribeUtxosChanged?.({ addresses: [address] });
    } catch { /* non-fatal */ }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getWsConnectionState(): WsConnectionState {
  return _state;
}

/**
 * Connect (or reconnect) to the Kaspa WebSocket RPC for the given network.
 * Safe to call multiple times — re-uses the existing connection if network matches.
 */
export async function connectKaspaWs(network: string): Promise<void> {
  if (_activeNetwork === network && (_state === "connected" || _state === "connecting")) return;

  // Disconnect existing connection if network changed
  if (_client) {
    await disconnectKaspaWs();
  }

  setState("connecting");
  _activeNetwork = network;

  try {
    const kaspa = await loadKaspaWasm();
    const RpcClient = (kaspa as Record<string, unknown>).RpcClient as
      | (new (config: unknown) => unknown)
      | undefined;

    if (!RpcClient) {
      setState("error");
      return;
    }

    const wsUrl = getWsUrl(network);
    const client = new RpcClient({ url: wsUrl });
    _client = client;

    const rpc = client as Record<string, unknown>;

    // Set up event listeners before connecting
    if (typeof rpc.addEventListener === "function") {
      (rpc.addEventListener as (event: string, cb: (data: unknown) => void) => void)(
        "connect",
        () => {
          setState("connected");
          resetBackoff();
          resubscribeAll().catch(() => {});
        },
      );
      (rpc.addEventListener as (event: string, cb: (data: unknown) => void) => void)(
        "disconnect",
        () => {
          setState("disconnected");
          scheduleReconnect(network);
        },
      );
      (rpc.addEventListener as (event: string, cb: (data: unknown) => void) => void)(
        "utxos-changed",
        (data: unknown) => {
          const payload = data as { added?: Array<{ address?: { payload?: string } }>; removed?: Array<{ address?: { payload?: string } }> };
          const affected = new Set<string>();
          for (const entry of [...(payload?.added ?? []), ...(payload?.removed ?? [])]) {
            const addr = entry?.address?.payload;
            if (addr) affected.add(addr);
          }
          for (const addr of affected) {
            // Invalidate the REST UTXO cache so next fetch is fresh
            invalidateEndpointPoolCache();
            const cbs = _utxoCallbacks.get(addr);
            if (cbs) for (const cb of cbs) cb();
          }
        },
      );
      (rpc.addEventListener as (event: string, cb: (data: unknown) => void) => void)(
        "virtual-daa-score-changed",
        (data: unknown) => {
          const score = (data as { virtualDaaScore?: bigint })?.virtualDaaScore;
          if (score !== undefined) {
            for (const cb of _daaCallbacks) cb(score);
          }
        },
      );
    }

    // Connect
    if (typeof (rpc.connect as unknown) === "function") {
      await (rpc.connect as () => Promise<void>)();
    }
  } catch {
    setState("error");
    scheduleReconnect(network);
  }
}

/**
 * Disconnect and clean up the active WebSocket connection.
 */
export async function disconnectKaspaWs(): Promise<void> {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  if (_client) {
    const rpc = _client as Record<string, unknown>;
    try {
      if (typeof rpc.disconnect === "function") {
        await (rpc.disconnect as () => Promise<void>)();
      }
    } catch { /* ignore disconnect errors */ }
    _client = null;
  }
  _activeNetwork = null;
  setState("disconnected");
}

/**
 * Subscribe to UTXO changes for a specific address.
 * Returns an unsubscribe function.
 */
export function subscribeUtxosChanged(address: string, onUpdate: () => void): () => void {
  if (!_utxoCallbacks.has(address)) {
    _utxoCallbacks.set(address, new Set());
    _subscribedAddresses.add(address);
    // Subscribe on the live connection if already connected
    if (_client && _state === "connected") {
      const rpc = _client as Record<string, (arg?: unknown) => Promise<void>>;
      rpc.subscribeUtxosChanged?.({ addresses: [address] }).catch(() => {});
    }
  }
  _utxoCallbacks.get(address)!.add(onUpdate);

  return () => {
    const cbs = _utxoCallbacks.get(address);
    if (cbs) {
      cbs.delete(onUpdate);
      if (cbs.size === 0) {
        _utxoCallbacks.delete(address);
        _subscribedAddresses.delete(address);
        if (_client && _state === "connected") {
          const rpc = _client as Record<string, (arg?: unknown) => Promise<void>>;
          rpc.unsubscribeUtxosChanged?.({ addresses: [address] }).catch(() => {});
        }
      }
    }
  };
}

/**
 * Subscribe to virtual DAA score updates.
 * Returns an unsubscribe function.
 */
export function subscribeDaaScore(onUpdate: (score: bigint) => void): () => void {
  _daaCallbacks.add(onUpdate);
  return () => {
    _daaCallbacks.delete(onUpdate);
  };
}
