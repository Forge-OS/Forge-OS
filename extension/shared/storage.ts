// Typed chrome.storage.local wrappers.
// SECURITY: ManagedWallet no longer carries a phrase field.
// The mnemonic lives exclusively in the encrypted vault (forgeos.vault.v1).
// The content bridge syncs only non-sensitive metadata (address, network, agents).
import {
  DEFAULT_DISPLAY_CURRENCY,
  normalizeDisplayCurrency,
  type DisplayCurrency,
} from "./fiat";

const KEYS = {
  agents: "forgeos.session.agents.v2",
  activeAgent: "forgeos.session.activeAgent.v2",
  // Wallet address + network only — phrase is in the vault, never here
  walletMeta: "forgeos.wallet.meta.v2",
  network: "forgeos.network",
  lastProvider: "forgeos.wallet.lastProvider.mainnet",
  // Auto-lock settings (minutes)
  autoLockMinutes: "forgeos.autolock.minutes.v1",
  // Allow unlock persistence across popup closes (session-scoped only)
  persistUnlockSession: "forgeos.unlock.persist-session.v1",
  // Preferred fiat display currency for portfolio value
  displayCurrency: "forgeos.display.currency.v1",
  // Privacy preference: hide balances in popup wallet UI
  hidePortfolioBalances: "forgeos.privacy.hide-balances.v1",
  // Preferred RPC provider preset by network id
  kaspaRpcProviderPresetMap: "forgeos.kaspa.rpc-provider.v1",
  // Optional runtime Kaspa API endpoint override by network id
  customKaspaRpcMap: "forgeos.kaspa.custom-rpc.v1",
} as const;

const AUTO_LOCK_MIN = 1;
const AUTO_LOCK_MAX = 24 * 60; // 24h
const AUTO_LOCK_NEVER = -1;
const DEFAULT_KASPA_RPC_PROVIDER_PRESET = "official" as const;

export type KaspaRpcProviderPreset = "official" | "igra" | "kasplex" | "custom";

function normalizeAutoLockMinutes(raw: unknown): number {
  if (raw === AUTO_LOCK_NEVER) return AUTO_LOCK_NEVER;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 15;
  const rounded = Math.floor(raw);
  return Math.min(AUTO_LOCK_MAX, Math.max(AUTO_LOCK_MIN, rounded));
}

function chromeStorage(): chrome.storage.LocalStorageArea | null {
  if (typeof chrome !== "undefined" && chrome.storage) return chrome.storage.local;
  return null;
}

function normalizeKaspaRpcEndpoint(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return trimmed.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function normalizeKaspaRpcMap(raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw === null) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k || "").trim();
    if (!key) continue;
    const endpoint = normalizeKaspaRpcEndpoint(v);
    if (!endpoint) continue;
    out[key] = endpoint;
  }
  return out;
}

function normalizeKaspaRpcProviderPreset(raw: unknown): KaspaRpcProviderPreset {
  if (raw === "igra") return "igra";
  if (raw === "kasplex") return "kasplex";
  if (raw === "custom") return "custom";
  return DEFAULT_KASPA_RPC_PROVIDER_PRESET;
}

function normalizeKaspaRpcProviderPresetMap(
  raw: unknown,
): Record<string, KaspaRpcProviderPreset> {
  if (typeof raw !== "object" || raw === null) return {};
  const out: Record<string, KaspaRpcProviderPreset> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k || "").trim();
    if (!key) continue;
    out[key] = normalizeKaspaRpcProviderPreset(v);
  }
  return out;
}

// ── Agents ───────────────────────────────────────────────────────────────────

export async function getAgents(): Promise<unknown[]> {
  const store = chromeStorage();
  if (!store) return [];
  return new Promise((resolve) => {
    store.get(KEYS.agents, (result) => {
      try {
        const raw = result[KEYS.agents];
        if (!raw) return resolve([]);
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        resolve(Array.isArray(parsed) ? parsed : []);
      } catch { resolve([]); }
    });
  });
}

export async function setAgents(agents: unknown[]): Promise<void> {
  const store = chromeStorage();
  if (!store) return;
  return new Promise((resolve) => {
    store.set({ [KEYS.agents]: JSON.stringify(agents) }, resolve);
  });
}

export async function getActiveAgentId(): Promise<string> {
  const store = chromeStorage();
  if (!store) return "";
  return new Promise((resolve) => {
    store.get(KEYS.activeAgent, (result) => resolve(result[KEYS.activeAgent] || ""));
  });
}

// ── Wallet metadata (address + network ONLY — no phrase) ─────────────────────

/**
 * Non-sensitive wallet metadata stored in chrome.storage.local.
 * The mnemonic is NEVER included here — it lives in the encrypted vault.
 */
export interface WalletMeta {
  address: string;
  network: string;
}

export async function getWalletMeta(): Promise<WalletMeta | null> {
  const store = chromeStorage();
  if (!store) return null;
  return new Promise((resolve) => {
    store.get(KEYS.walletMeta, (result) => {
      try {
        const raw = result[KEYS.walletMeta];
        if (!raw) return resolve(null);
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        resolve(parsed?.address ? (parsed as WalletMeta) : null);
      } catch { resolve(null); }
    });
  });
}

export async function setWalletMeta(meta: WalletMeta): Promise<void> {
  const store = chromeStorage();
  if (!store) return;
  return new Promise((resolve) => {
    store.set({ [KEYS.walletMeta]: JSON.stringify(meta) }, resolve);
  });
}

export async function clearWalletMeta(): Promise<void> {
  const store = chromeStorage();
  if (!store) return;
  return new Promise((resolve) => {
    store.remove(KEYS.walletMeta, resolve);
  });
}

// ── Network ───────────────────────────────────────────────────────────────────

export async function getNetwork(): Promise<string> {
  const store = chromeStorage();
  if (!store) return "mainnet";
  return new Promise((resolve) => {
    store.get(KEYS.network, (result) => resolve(result[KEYS.network] || "mainnet"));
  });
}

export async function setNetwork(network: string): Promise<void> {
  const store = chromeStorage();
  if (!store) return;
  return new Promise((resolve) => {
    store.set({ [KEYS.network]: network }, resolve);
  });
}

// ── Auto-lock settings ────────────────────────────────────────────────────────

export async function getAutoLockMinutes(): Promise<number> {
  const store = chromeStorage();
  if (!store) return 15;
  return new Promise((resolve) => {
    store.get(KEYS.autoLockMinutes, (result) => {
      resolve(normalizeAutoLockMinutes(result[KEYS.autoLockMinutes]));
    });
  });
}

export async function setAutoLockMinutes(minutes: number): Promise<void> {
  const store = chromeStorage();
  if (!store) return;
  return new Promise((resolve) => {
    store.set({ [KEYS.autoLockMinutes]: normalizeAutoLockMinutes(minutes) }, resolve);
  });
}

export async function getPersistUnlockSession(): Promise<boolean> {
  const store = chromeStorage();
  if (!store) return false;
  return new Promise((resolve) => {
    store.get(KEYS.persistUnlockSession, (result) => {
      resolve(result[KEYS.persistUnlockSession] === true);
    });
  });
}

export async function setPersistUnlockSession(enabled: boolean): Promise<void> {
  const store = chromeStorage();
  if (!store) return;
  return new Promise((resolve) => {
    store.set({ [KEYS.persistUnlockSession]: enabled === true }, resolve);
  });
}

// ── Display currency settings ────────────────────────────────────────────────

export async function getDisplayCurrency(): Promise<DisplayCurrency> {
  const store = chromeStorage();
  if (!store) return DEFAULT_DISPLAY_CURRENCY;
  return new Promise((resolve) => {
    store.get(KEYS.displayCurrency, (result) => {
      resolve(normalizeDisplayCurrency(result[KEYS.displayCurrency]));
    });
  });
}

export async function setDisplayCurrency(currency: DisplayCurrency): Promise<void> {
  const store = chromeStorage();
  if (!store) return;
  return new Promise((resolve) => {
    store.set({ [KEYS.displayCurrency]: normalizeDisplayCurrency(currency) }, resolve);
  });
}

// ── Privacy settings ─────────────────────────────────────────────────────────

export async function getHidePortfolioBalances(): Promise<boolean> {
  const store = chromeStorage();
  if (!store) return false;
  return new Promise((resolve) => {
    store.get(KEYS.hidePortfolioBalances, (result) => {
      resolve(result[KEYS.hidePortfolioBalances] === true);
    });
  });
}

export async function setHidePortfolioBalances(hide: boolean): Promise<void> {
  const store = chromeStorage();
  if (!store) return;
  return new Promise((resolve) => {
    store.set({ [KEYS.hidePortfolioBalances]: hide === true }, resolve);
  });
}

// ── Custom Kaspa RPC endpoint overrides ─────────────────────────────────────

export async function getKaspaRpcProviderPresetMap(): Promise<Record<string, KaspaRpcProviderPreset>> {
  const store = chromeStorage();
  if (!store) return {};
  return new Promise((resolve) => {
    store.get(KEYS.kaspaRpcProviderPresetMap, (result) => {
      try {
        const raw = result[KEYS.kaspaRpcProviderPresetMap];
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        resolve(normalizeKaspaRpcProviderPresetMap(parsed));
      } catch {
        resolve({});
      }
    });
  });
}

export async function getKaspaRpcProviderPreset(network: string): Promise<KaspaRpcProviderPreset> {
  const key = String(network || "").trim();
  if (!key) return DEFAULT_KASPA_RPC_PROVIDER_PRESET;
  const map = await getKaspaRpcProviderPresetMap();
  return map[key] ?? DEFAULT_KASPA_RPC_PROVIDER_PRESET;
}

export async function setKaspaRpcProviderPreset(
  network: string,
  preset: KaspaRpcProviderPreset,
): Promise<void> {
  const store = chromeStorage();
  if (!store) return;
  const key = String(network || "").trim();
  if (!key) return;

  const map = await getKaspaRpcProviderPresetMap();
  map[key] = normalizeKaspaRpcProviderPreset(preset);

  return new Promise((resolve) => {
    store.set({ [KEYS.kaspaRpcProviderPresetMap]: JSON.stringify(map) }, resolve);
  });
}

export async function getCustomKaspaRpcMap(): Promise<Record<string, string>> {
  const store = chromeStorage();
  if (!store) return {};
  return new Promise((resolve) => {
    store.get(KEYS.customKaspaRpcMap, (result) => {
      try {
        const raw = result[KEYS.customKaspaRpcMap];
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        resolve(normalizeKaspaRpcMap(parsed));
      } catch {
        resolve({});
      }
    });
  });
}

export async function getCustomKaspaRpc(network: string): Promise<string | null> {
  const key = String(network || "").trim();
  if (!key) return null;
  const map = await getCustomKaspaRpcMap();
  return map[key] ?? null;
}

export async function setCustomKaspaRpc(network: string, endpoint: string | null): Promise<void> {
  const store = chromeStorage();
  if (!store) return;
  const key = String(network || "").trim();
  if (!key) return;

  const map = await getCustomKaspaRpcMap();

  if (endpoint === null || endpoint.trim() === "") {
    delete map[key];
  } else {
    const normalized = normalizeKaspaRpcEndpoint(endpoint);
    if (!normalized) throw new Error("INVALID_RPC_ENDPOINT");
    map[key] = normalized;
  }

  return new Promise((resolve) => {
    store.set({ [KEYS.customKaspaRpcMap]: JSON.stringify(map) }, resolve);
  });
}

// ── Legacy shim ───────────────────────────────────────────────────────────────
// Kept for backward compatibility during migration. Remove after one release cycle.

/** @deprecated Use getWalletMeta() — phrase field is always undefined. */
export interface ManagedWallet {
  address: string;
  network: string;
  phrase?: never; // Explicitly forbidden — phrase lives in the vault only
}

/** @deprecated Use getWalletMeta(). */
export async function getManagedWallet(): Promise<ManagedWallet | null> {
  return getWalletMeta();
}

/** @deprecated Use setWalletMeta(). */
export async function setManagedWallet(data: Pick<ManagedWallet, "address" | "network">): Promise<void> {
  return setWalletMeta(data);
}

/** @deprecated Use resetWallet() from vault/vault.ts for a full wipe. */
export async function clearManagedWallet(): Promise<void> {
  return clearWalletMeta();
}
