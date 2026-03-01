// Web vault — encrypted wallet storage for the PWA/mobile web app.
//
// Shares the same Argon2id KDF + AES-256-GCM crypto as the extension vault.
// Backed by localStorage instead of chrome.storage.local — works on any browser,
// including mobile Safari and Chrome with no extension required.
//
// Security invariants (same as extension vault):
//  1. Mnemonic encrypted at rest — Argon2id key derivation (64 MB, 3 passes).
//  2. Plaintext mnemonic lives only in _session (in-memory) while unlocked.
//  3. lockWebVault() wipes the reference and clears the auto-lock timer.
//  4. No plaintext mnemonic is ever written to localStorage.

import { deriveKeyArgon2id, deriveKey, randomBytes, DEFAULT_ARGON_PARAMS } from "../../extension/vault/kdf";
import { aesGcmEncrypt, aesGcmDecrypt, hexToBytes, bytesToHex } from "../../extension/crypto/aes";
import type { EncryptedVault, EncryptedVaultV2, VaultPayload, UnlockedSession } from "../../extension/vault/types";
import { DEFAULT_KASPA_DERIVATION, normalizeKaspaDerivation } from "../wallet/derivation";
import { loadKaspaWasm } from "../wallet/kaspaWasmLoader";

const VAULT_KEY = "forgeos.webvault.v2";
const DEFAULT_AUTO_LOCK_MINUTES = 30;

// ── In-memory session ─────────────────────────────────────────────────────────
let _session: UnlockedSession | null = null;
let _autoLockTimer: ReturnType<typeof setTimeout> | null = null;

// B3-equivalent: cached private key hex for the session lifetime
let _cachedPrivKey: { address: string; keyHex: string } | null = null;

function _wipeSession(): void {
  if (_session) {
    try { (_session as unknown as Record<string, unknown>).mnemonic = ""; } catch {}
    _session = null;
  }
  _cachedPrivKey = null;
  if (_autoLockTimer) { clearTimeout(_autoLockTimer); _autoLockTimer = null; }
}

function _scheduleAutoLock(autoLockAt: number): void {
  if (_autoLockTimer) { clearTimeout(_autoLockTimer); _autoLockTimer = null; }
  if (Number.isFinite(autoLockAt)) {
    const delay = Math.max(0, autoLockAt - Date.now());
    _autoLockTimer = setTimeout(() => _wipeSession(), delay);
  }
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function readVaultRaw(): EncryptedVault | null {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as EncryptedVault;
  } catch { return null; }
}

function writeVaultRaw(vault: EncryptedVault): void {
  localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
}

// ── Public API ────────────────────────────────────────────────────────────────

export function webVaultExists(): boolean {
  return Boolean(readVaultRaw());
}

export interface WebVaultCreateOptions {
  mnemonicPassphrase?: string;
  derivation?: Parameters<typeof normalizeKaspaDerivation>[0] | null;
}

export async function createWebVault(
  mnemonic: string,
  password: string,
  address: string,
  network: string,
  options: WebVaultCreateOptions = {},
): Promise<void> {
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const argonParams = DEFAULT_ARGON_PARAMS;
  const key = await deriveKeyArgon2id(password, salt, argonParams);
  const derivation = normalizeKaspaDerivation(options.derivation ?? DEFAULT_KASPA_DERIVATION);

  const payload: VaultPayload = {
    version: 1,
    mnemonic,
    mnemonicPassphrase: options.mnemonicPassphrase || undefined,
    derivation,
    address,
    network: network as VaultPayload["network"],
    derivationPath: `${derivation.path}/${derivation.account}'`,
    addressIndex: derivation.index,
  };

  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await aesGcmEncrypt(key, iv, plaintext);

  const existing = readVaultRaw();
  const vault: EncryptedVaultV2 = {
    version: 2,
    kdf: "argon2id",
    argon: argonParams,
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    ciphertext: bytesToHex(ciphertext),
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  writeVaultRaw(vault);
}

export async function unlockWebVault(
  password: string,
  autoLockMinutes: number = DEFAULT_AUTO_LOCK_MINUTES,
): Promise<UnlockedSession> {
  const vault = readVaultRaw();
  if (!vault) throw new Error("NO_VAULT");

  const salt = hexToBytes(vault.salt);
  const iv = hexToBytes(vault.iv);
  const ciphertext = hexToBytes(vault.ciphertext);

  let key: CryptoKey;
  if (vault.version === 2 && vault.kdf === "argon2id") {
    key = await deriveKeyArgon2id(password, salt, vault.argon);
  } else {
    key = await deriveKey(password, salt);
  }

  let plaintext: Uint8Array;
  try {
    plaintext = await aesGcmDecrypt(key, iv, ciphertext);
  } catch {
    throw new Error("INVALID_PASSWORD");
  }

  const payload: VaultPayload = JSON.parse(new TextDecoder().decode(plaintext));
  const autoLockAt = autoLockMinutes > 0
    ? Date.now() + autoLockMinutes * 60_000
    : Number.POSITIVE_INFINITY;

  _session = {
    mnemonic: payload.mnemonic,
    mnemonicPassphrase: typeof payload.mnemonicPassphrase === "string" ? payload.mnemonicPassphrase : undefined,
    derivation: normalizeKaspaDerivation(payload.derivation ?? DEFAULT_KASPA_DERIVATION),
    address: payload.address,
    network: payload.network,
    autoLockAt,
  };

  _scheduleAutoLock(autoLockAt);

  // Transparent v1 → v2 migration
  if (vault.version !== 2) {
    createWebVault(payload.mnemonic, password, payload.address, payload.network, {
      mnemonicPassphrase: payload.mnemonicPassphrase,
      derivation: payload.derivation,
    }).catch(() => {});
  }

  return _session;
}

export function lockWebVault(): void {
  _wipeSession();
}

export function getWebSession(): UnlockedSession | null {
  if (!_session) return null;
  if (Date.now() > _session.autoLockAt) { _wipeSession(); return null; }
  return _session;
}

export function extendWebSession(minutes: number): void {
  if (!_session) return;
  const autoLockAt = minutes > 0 ? Date.now() + minutes * 60_000 : Number.POSITIVE_INFINITY;
  _session.autoLockAt = autoLockAt;
  _scheduleAutoLock(autoLockAt);
}

export function getCachedWebPrivKey(address: string): string | null {
  return _cachedPrivKey?.address === address ? _cachedPrivKey.keyHex : null;
}

export function setCachedWebPrivKey(address: string, keyHex: string): void {
  _cachedPrivKey = { address, keyHex };
}

export async function resetWebVault(): Promise<void> {
  _wipeSession();
  localStorage.removeItem(VAULT_KEY);
}

// ── Address derivation helpers ────────────────────────────────────────────────
// Used by WebWalletSetup to derive addresses without storing anything.

export async function generateWebWalletMnemonic(wordCount: 12 | 24 = 12): Promise<string> {
  const kaspa = await loadKaspaWasm();
  const Mnemonic = (kaspa as Record<string, unknown>).Mnemonic as
    | { random: (words?: number) => string }
    | undefined;
  if (!Mnemonic) throw new Error("kaspa-wasm Mnemonic not available");
  try {
    return (Mnemonic as any).random(wordCount);
  } catch {
    return (Mnemonic as any).random();
  }
}

export async function deriveAddressFromMnemonic(
  mnemonic: string,
  network: string,
  passphrase?: string,
): Promise<string> {
  const kaspa = await loadKaspaWasm();
  const { Mnemonic, XPrv, XPrivateKey } = kaspa as Record<string, unknown> as {
    Mnemonic: new (phrase: string) => { toSeed: (p?: string) => string };
    XPrv: new (seed: string) => { derivePath: (path: string) => unknown; intoString: (prefix: string) => string };
    XPrivateKey: new (xprvStr: string, isMultisig: boolean, accountIndex: bigint) => {
      receiveKey: (index: number) => { toAddress: (network: string) => { toString: () => string } };
    };
  };

  const derivation = DEFAULT_KASPA_DERIVATION;
  const mn = new Mnemonic(mnemonic);
  const seed = mn.toSeed(passphrase || undefined);
  const masterXPrv = new XPrv(seed);

  let accountRoot = masterXPrv;
  try {
    accountRoot = masterXPrv.derivePath(derivation.path) as typeof masterXPrv;
  } catch {
    try { accountRoot = masterXPrv.derivePath(derivation.path.slice(2)) as typeof masterXPrv; } catch {}
  }

  const xprvStr = accountRoot.intoString("kprv");
  const xprvKey = new XPrivateKey(xprvStr, false, BigInt(derivation.account));
  const key = xprvKey.receiveKey(derivation.index);
  return key.toAddress(network).toString();
}
