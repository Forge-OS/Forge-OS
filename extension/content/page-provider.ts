// Forge-OS Page Provider — content script running in MAIN world on forge-os.xyz
//
// Injects window.forgeos so page JavaScript can call connect() / signMessage().
// Communicates with site-bridge.ts (isolated world) via window.postMessage.
//
// NOTE: All signing routes through the extension vault bridge (FORGEOS_SIGN).
// kaspa-wasm is NOT imported here — it is too large for a MAIN-world content
// script and Chrome MV3 CSP blocks WASM instantiation in content scripts.

const WALLET_KEY = "forgeos.managed.wallet.v1";

// Sentinel field prevents collision with other postMessage traffic.
const S = "__forgeos__" as const;

type BridgeMsg = { [key: string]: unknown; __forgeos__: true; type: string; requestId?: string };
type Pending   = { resolve(v: any): void; reject(e: any): void; timer: ReturnType<typeof setTimeout> };

const pending = new Map<string, Pending>();

// ── Response listener ────────────────────────────────────────────────────────

window.addEventListener("message", (ev) => {
  if (ev.source !== window) return;
  const msg = ev.data as BridgeMsg & { result?: unknown; error?: unknown };
  if (!msg?.[S]) return;
  if (typeof msg.requestId !== "string") return;

  // Ignore outbound request messages posted by this provider/site bridge.
  // We only want response-shaped messages that include result/error fields.
  if (!("result" in msg) && !("error" in msg)) return;

  const req = pending.get(msg.requestId);
  if (!req) return;

  clearTimeout(req.timer);
  pending.delete(msg.requestId);

  if (msg.error) {
    req.reject(new Error(String(msg.error)));
  } else {
    req.resolve(msg.result);
  }
});

// ── Request helper ───────────────────────────────────────────────────────────

function bridgeRequest(type: string, extra?: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("Forge-OS: request timed out"));
    }, 120_000);
    pending.set(requestId, { resolve, reject, timer });
    window.postMessage({ [S]: true, type, requestId, ...extra }, "*");
  });
}

// ── Provider factory ─────────────────────────────────────────────────────────

function createProvider() {
  return {
    isForgeOS: true as const,
    version: "1.0.0",

    /** Connect: fast-path from localStorage managed wallet; fallback via extension popup. */
    async connect(): Promise<{ address: string; network: string } | null> {
      try {
        const raw = localStorage.getItem(WALLET_KEY);
        if (raw) {
          const w = JSON.parse(raw);
          if (w?.address && w?.network) return { address: w.address, network: w.network };
        }
      } catch {}
      // Extension vault path — opens popup for password entry / approval
      return bridgeRequest("FORGEOS_CONNECT");
    },

    /** Sign a message via the extension vault (secure path). */
    async signMessage(message: string): Promise<string> {
      return bridgeRequest("FORGEOS_SIGN", { message });
    },

    /** Request the extension popup to open (MetaMask-style). */
    openExtension(): void {
      window.postMessage({ [S]: true, type: "FORGEOS_OPEN_POPUP" }, "*");
    },

    disconnect(): void { /* managed wallet — nothing to tear down */ },
  };
}

// ── Inject ───────────────────────────────────────────────────────────────────

if (!(window as any).forgeos?.isForgeOS) {
  (window as any).forgeos = createProvider();
  // Notify any listener that the provider is ready.
  window.dispatchEvent(new CustomEvent("forgeos#initialized"));
}
