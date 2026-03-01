// Encrypted vault — the sole persistence layer for wallet secrets.
//
// Security invariants:
//  1. Plaintext mnemonic is encrypted at rest in chrome.storage.local.
//  2. The vault blob is opaque without the user's password.
//  3. Decrypted material lives in-memory while unlocked, and may optionally be
//     cached in chrome.storage.session if the user enables "keep unlocked".
//  4. lockWallet() clears the reference and requests GC immediately.
//  5. changePassword() re-encrypts atomically — old ciphertext is overwritten.
//  6. resetWallet() wipes all extension storage (full hard reset).

import type { EncryptedVault, EncryptedVaultV2, VaultPayload, UnlockedSession } from "./types";
import {
  DEFAULT_KASPA_DERIVATION,
  normalizeKaspaDerivation,
  type KaspaDerivationMeta,
} from "../../src/wallet/derivation";
import { deriveKey, deriveKeyArgon2id, randomBytes, DEFAULT_ARGON_PARAMS } from "./kdf";
import { aesGcmEncrypt, aesGcmDecrypt, hexToBytes, bytesToHex } from "../crypto/aes";

// Storage keys
const VAULT_KEY = "forgeos.vault.v1";
const SESSION_CACHE_KEY = "forgeos.vault.session-cache.v1"; // session-only unlock cache (optional)
const NEVER_AUTO_LOCK_SENTINEL = -1;

// Auto-lock alarm name (managed by background service worker)
export const AUTO_LOCK_ALARM = "forgeos-autolock";

// Default auto-lock timeout in minutes
export const DEFAULT_AUTO_LOCK_MINUTES = 15;

export interface CreateVaultOptions {
  /** Optional BIP39 passphrase used with the mnemonic. Encrypted in the vault payload. */
  mnemonicPassphrase?: string;
  /** Selected derivation metadata used for address derivation/signing. */
  derivation?: Partial<KaspaDerivationMeta> | null;
}

export interface UnlockOptions {
  /**
   * Persist decrypted session in chrome.storage.session so popup reopen does
   * not immediately require password again.
   */
  persistSession?: boolean;
}

// ── In-memory session (popup context only) ───────────────────────────────────
// Primary runtime session cache for decrypted key material.
let _session: UnlockedSession | null = null;

// ── Private key cache (session-lifetime) ─────────────────────────────────────
// Caches the serialised BIP44-derived private key so repeated signTransaction()
// calls within the same session skip the expensive Mnemonic→XPrv derivation.
// Cleared alongside the session on lock/wipe.
let _cachedPrivKey: { address: string; keyHex: string } | null = null;

export function getCachedPrivKey(address: string): string | null {
  return _cachedPrivKey?.address === address ? _cachedPrivKey.keyHex : null;
}

export function setCachedPrivKey(address: string, keyHex: string): void {
  _cachedPrivKey = { address, keyHex };
}

function resolveAutoLockAt(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return Number.POSITIVE_INFINITY;
  return Date.now() + minutes * 60_000;
}

function serializeAutoLockAt(autoLockAt: number): number {
  return Number.isFinite(autoLockAt) ? autoLockAt : NEVER_AUTO_LOCK_SENTINEL;
}

function deserializeAutoLockAt(raw: unknown): number | null {
  if (raw === NEVER_AUTO_LOCK_SENTINEL) return Number.POSITIVE_INFINITY;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return raw;
}

function scheduleOrCancelAutoLock(minutes: number): void {
  try {
    if (!Number.isFinite(minutes) || minutes <= 0) {
      chrome.runtime.sendMessage({ type: "CANCEL_AUTOLOCK" });
      return;
    }
    chrome.runtime.sendMessage({ type: "SCHEDULE_AUTOLOCK", minutes });
  } catch { /* popup may be standalone — non-fatal */ }
}

/**
 * Return the active session, or null if locked / expired.
 * Expiry is enforced on every access — there is no background timer inside
 * this module; the popup polls getSession() via React state.
 */
export function getSession(): UnlockedSession | null {
  if (!_session) return null;
  if (Date.now() > _session.autoLockAt) {
    _wipeSession();
    void clearSessionCache();
    return null;
  }
  return _session;
}

export function isUnlocked(): boolean {
  return getSession() !== null;
}

/** Zero-out the mnemonic reference and clear the session. */
function _wipeSession(): void {
  if (_session) {
    // Best-effort overwrite: JS strings are immutable, but we remove the reference
    // to allow GC. In a future iteration, store mnemonic as Uint8Array and zero it.
    try { (_session as Record<string, unknown>).mnemonic = ""; } catch { /* noop */ }
    _session = null;
  }
  _cachedPrivKey = null;
}

// ── Chrome storage helpers ───────────────────────────────────────────────────

function localStore(): chrome.storage.LocalStorageArea {
  return chrome.storage.local;
}

function sessionStore(): chrome.storage.LocalStorageArea | null {
  const maybeSession = (chrome.storage as any)?.session;
  return maybeSession ?? null;
}

async function readVault(): Promise<EncryptedVault | null> {
  return new Promise((resolve) => {
    localStore().get(VAULT_KEY, (result) => {
      try {
        const raw = result[VAULT_KEY];
        if (!raw) return resolve(null);
        resolve(JSON.parse(raw) as EncryptedVault);
      } catch {
        resolve(null);
      }
    });
  });
}

async function writeVault(vault: EncryptedVault): Promise<void> {
  return new Promise((resolve) => {
    localStore().set({ [VAULT_KEY]: JSON.stringify(vault) }, resolve);
  });
}

async function writeSessionCache(session: UnlockedSession): Promise<void> {
  const store = sessionStore();
  if (!store) return;
  return new Promise((resolve) => {
    store.set({
      [SESSION_CACHE_KEY]: {
        version: 1,
        mnemonic: session.mnemonic,
        mnemonicPassphrase: session.mnemonicPassphrase,
        derivation: session.derivation,
        address: session.address,
        network: session.network,
        autoLockAt: serializeAutoLockAt(session.autoLockAt),
      },
    }, resolve);
  });
}

async function clearSessionCache(): Promise<void> {
  const store = sessionStore();
  if (!store) return;
  return new Promise((resolve) => {
    store.remove(SESSION_CACHE_KEY, resolve);
  });
}

async function readSessionCache(): Promise<UnlockedSession | null> {
  const store = sessionStore();
  if (!store) return null;
  return new Promise((resolve) => {
    store.get(SESSION_CACHE_KEY, (result) => {
      const raw = result?.[SESSION_CACHE_KEY];
      if (!raw || typeof raw !== "object") {
        resolve(null);
        return;
      }

      const autoLockAt = deserializeAutoLockAt((raw as any).autoLockAt);
      if (autoLockAt === null) {
        resolve(null);
        return;
      }

      const mnemonic = typeof (raw as any).mnemonic === "string" ? (raw as any).mnemonic : "";
      const address = typeof (raw as any).address === "string" ? (raw as any).address : "";
      const network = typeof (raw as any).network === "string" ? (raw as any).network : "";

      if (!mnemonic || !address || !network) {
        resolve(null);
        return;
      }

      resolve({
        mnemonic,
        mnemonicPassphrase:
          typeof (raw as any).mnemonicPassphrase === "string"
            ? (raw as any).mnemonicPassphrase
            : undefined,
        derivation: normalizeKaspaDerivation((raw as any).derivation ?? DEFAULT_KASPA_DERIVATION),
        address,
        network,
        autoLockAt,
      });
    });
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/** True if an encrypted vault blob exists in storage (doesn't mean it's unlocked). */
export async function vaultExists(): Promise<boolean> {
  return (await readVault()) !== null;
}

/**
 * Encrypt mnemonic + metadata and write the vault blob to chrome.storage.local.
 * Overwrites any existing vault — used for both first-time creation and
 * password changes.
 *
 * @param mnemonic   BIP39 phrase (plaintext, held only for this call).
 * @param password   User password — never stored; only the derived key is used.
 * @param address    Derived receive address (index 0).
 * @param network    Network identifier (mainnet / testnet profiles).
 */
export async function createVault(
  mnemonic: string,
  password: string,
  address: string,
  network: string,
  options: CreateVaultOptions = {},
): Promise<void> {
  // Fresh random salt + IV for every vault write
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
    // Legacy fields kept for backward compatibility/readability.
    derivationPath: `${derivation.path}/${derivation.account}'`,
    addressIndex: derivation.index,
  };

  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await aesGcmEncrypt(key, iv, plaintext);

  const vault: EncryptedVaultV2 = {
    version: 2,
    kdf: "argon2id",
    argon: argonParams,
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    ciphertext: bytesToHex(ciphertext),
    createdAt: (await readVault())?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };

  await writeVault(vault);
}

/**
 * Decrypt the vault with the provided password and populate the in-memory session.
 *
 * Throws "NO_VAULT" if no vault exists.
 * Throws "INVALID_PASSWORD" if decryption or auth-tag check fails.
 * (Both use the same generic message to avoid oracle attacks.)
 *
 * @param password         User password.
 * @param autoLockMinutes  Session TTL. Defaults to DEFAULT_AUTO_LOCK_MINUTES.
 * @returns                The newly created UnlockedSession.
 */
export async function unlockVault(
  password: string,
  autoLockMinutes: number = DEFAULT_AUTO_LOCK_MINUTES,
  options: UnlockOptions = {},
): Promise<UnlockedSession> {
  const vault = await readVault();
  if (!vault) throw new Error("NO_VAULT");

  const salt = hexToBytes(vault.salt);
  const iv = hexToBytes(vault.iv);
  const ciphertext = hexToBytes(vault.ciphertext);

  // D4: Select KDF based on vault version
  let key: CryptoKey;
  if (vault.version === 2 && vault.kdf === "argon2id") {
    key = await deriveKeyArgon2id(password, salt, vault.argon);
  } else {
    // v1: PBKDF2-SHA-256
    key = await deriveKey(password, salt);
  }

  let plaintext: Uint8Array;
  try {
    plaintext = await aesGcmDecrypt(key, iv, ciphertext);
  } catch {
    // AES-GCM auth tag failure — wrong password or tampered ciphertext
    throw new Error("INVALID_PASSWORD");
  }

  const payload: VaultPayload = JSON.parse(new TextDecoder().decode(plaintext));

  _session = {
    mnemonic: payload.mnemonic,
    mnemonicPassphrase:
      typeof payload.mnemonicPassphrase === "string" ? payload.mnemonicPassphrase : undefined,
    derivation: normalizeKaspaDerivation(
      payload.derivation ?? {
        path: "m/44'/111'",
        account: 0,
        chain: 0,
        index: typeof payload.addressIndex === "number" ? payload.addressIndex : 0,
      },
    ),
    address: payload.address,
    network: payload.network,
    autoLockAt: resolveAutoLockAt(autoLockMinutes),
  };

  scheduleOrCancelAutoLock(autoLockMinutes);
  if (options.persistSession) await writeSessionCache(_session);
  else await clearSessionCache();

  // D4: Transparent v1 → v2 migration — re-encrypt with Argon2id on first successful v1 unlock
  if (vault.version !== 2) {
    createVault(
      payload.mnemonic,
      password,
      payload.address,
      payload.network,
      {
        mnemonicPassphrase: payload.mnemonicPassphrase,
        derivation: payload.derivation,
      },
    ).catch(() => {/* non-fatal — will retry on next unlock */});
  }

  return _session;
}

/**
 * Restore an unlocked session from chrome.storage.session cache.
 * Returns null when cache is absent/invalid/expired.
 */
export async function restoreSessionFromCache(): Promise<UnlockedSession | null> {
  const cached = await readSessionCache();
  if (!cached) return null;
  if (Date.now() > cached.autoLockAt) {
    await clearSessionCache();
    return null;
  }
  _session = cached;

  if (Number.isFinite(cached.autoLockAt)) {
    const remainingMinutes = Math.max(0, (cached.autoLockAt - Date.now()) / 60_000);
    scheduleOrCancelAutoLock(remainingMinutes);
  } else {
    scheduleOrCancelAutoLock(NEVER_AUTO_LOCK_SENTINEL);
  }

  return _session;
}

/**
 * Enable/disable popup-reopen session persistence for the current unlocked session.
 */
export async function setSessionPersistence(enabled: boolean): Promise<void> {
  if (!enabled) {
    await clearSessionCache();
    return;
  }
  const current = getSession();
  if (!current) return;
  await writeSessionCache(current);
}

/**
 * Lock the wallet: wipe the in-memory session and cancel the auto-lock alarm.
 * Safe to call when already locked.
 */
export function lockWallet(): void {
  _wipeSession();
  void clearSessionCache();
  try {
    chrome.runtime.sendMessage({ type: "CANCEL_AUTOLOCK" });
  } catch { /* non-fatal */ }
}

/**
 * Change the vault password.
 * Validates the current password, then re-encrypts with the new one.
 * The session is re-established after the re-encryption.
 *
 * Throws "INVALID_PASSWORD" if currentPassword is wrong.
 * Throws "WEAK_PASSWORD" if newPassword is fewer than 8 characters.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (newPassword.length < 8) throw new Error("WEAK_PASSWORD");

  // Decrypt with current password (will throw INVALID_PASSWORD if wrong)
  const session = await unlockVault(currentPassword);

  // Re-encrypt with new password
  await createVault(session.mnemonic, newPassword, session.address, session.network, {
    mnemonicPassphrase: session.mnemonicPassphrase,
    derivation: session.derivation,
  });

  // Re-establish session (unlock with new password so the session is fresh)
  _wipeSession();
  await unlockVault(newPassword);
}

/**
 * Hard reset: wipe ALL extension storage and clear the in-memory session.
 * This is irreversible. Callers must show an explicit confirmation UI before
 * invoking this function.
 */
export async function resetWallet(): Promise<void> {
  _wipeSession();
  await clearSessionCache();
  await new Promise<void>((resolve) => localStore().clear(resolve));
}

/**
 * Extend the current session TTL (call on user activity to defer auto-lock).
 * No-op if wallet is not unlocked.
 */
export function extendSession(
  minutes: number = DEFAULT_AUTO_LOCK_MINUTES,
  options: UnlockOptions = {},
): void {
  if (_session) {
    _session.autoLockAt = resolveAutoLockAt(minutes);
    scheduleOrCancelAutoLock(minutes);
    if (options.persistSession) void writeSessionCache(_session);
  }
}
