export type KaspaDerivationChain = 0 | 1;

export interface KaspaDerivationMeta {
  /**
   * Base path up to (but not including) account.
   * Example standard Kaspa BIP44 path root: m/44'/111'
   */
  path: string;
  account: number;
  chain: KaspaDerivationChain; // 0=receive, 1=change
  index: number;
}

export const DEFAULT_KASPA_DERIVATION: KaspaDerivationMeta = Object.freeze({
  path: "m/44'/111'",
  account: 0,
  chain: 0,
  index: 0,
});

export const COMMON_KASPA_IMPORT_BASE_PATHS = Object.freeze([
  "m/44'/111'",
  // Some wallets/tools may experiment with alternate coin types.
  "m/44'/972'",
]);

function asNonNegativeInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function normalizeBasePath(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return DEFAULT_KASPA_DERIVATION.path;
  // Minimal sanity check; kaspa-wasm will do the strict parse.
  return raw.startsWith("m") ? raw : `m/${raw}`;
}

export function normalizeKaspaDerivation(
  value?: Partial<KaspaDerivationMeta> | null,
): KaspaDerivationMeta {
  return {
    path: normalizeBasePath(value?.path),
    account: asNonNegativeInt(value?.account, DEFAULT_KASPA_DERIVATION.account),
    chain: (value?.chain === 1 ? 1 : 0),
    index: asNonNegativeInt(value?.index, DEFAULT_KASPA_DERIVATION.index),
  };
}

export function formatKaspaDerivationPath(meta?: Partial<KaspaDerivationMeta> | null): string {
  const d = normalizeKaspaDerivation(meta);
  return `${d.path}/${d.account}'/${d.chain}/${d.index}`;
}

export function derivationChainLabel(chain: KaspaDerivationChain): "receive" | "change" {
  return chain === 1 ? "change" : "receive";
}

/**
 * Parse full derivation path format:
 *   m/44'/111'/0'/0/0
 * into { path: "m/44'/111'", account:0, chain:0, index:0 }.
 */
export function parseKaspaDerivationPath(path: string): KaspaDerivationMeta {
  const raw = String(path || "").trim();
  const m = raw.match(/^(m(?:\/\d+'?)*)\/(\d+)'\s*\/([01])\s*\/(\d+)$/i);
  if (!m) {
    throw new Error(
      "Invalid derivation path. Expected format like m/44'/111'/0'/0/0",
    );
  }
  return normalizeKaspaDerivation({
    path: m[1],
    account: Number(m[2]),
    chain: Number(m[3]) as KaspaDerivationChain,
    index: Number(m[4]),
  });
}
