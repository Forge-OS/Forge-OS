// Vault type definitions — no plaintext secrets ever leave this boundary.
import type { KaspaDerivationMeta } from "../../src/wallet/derivation";
import type { ArgonParams } from "./kdf";

/**
 * V1 vault — PBKDF2-SHA-256, 600k iterations.
 * Retained for reading legacy vaults; silently migrated to V2 on next unlock.
 */
export interface EncryptedVaultV1 {
  version: 1;
  kdf: "pbkdf2";
  salt: string;        // hex-encoded, 32 bytes
  iterations: number;  // PBKDF2 iteration count (600_000)
  hash: "SHA-256";
  iv: string;          // hex-encoded, 12 bytes (AES-GCM nonce)
  ciphertext: string;  // hex-encoded — AES-256-GCM ciphertext + 16-byte auth tag
  createdAt: number;   // Unix ms
  updatedAt: number;   // Unix ms
}

/**
 * V2 vault — Argon2id KDF (64 MB, 3 passes, 4 lanes).
 * Default for all newly created vaults.
 */
export interface EncryptedVaultV2 {
  version: 2;
  kdf: "argon2id";
  argon: ArgonParams;
  salt: string;        // hex-encoded, 32 bytes
  iv: string;          // hex-encoded, 12 bytes (AES-GCM nonce)
  ciphertext: string;  // hex-encoded — AES-256-GCM ciphertext + 16-byte auth tag
  createdAt: number;   // Unix ms
  updatedAt: number;   // Unix ms
}

/** Union of all supported vault versions. */
export type EncryptedVault = EncryptedVaultV1 | EncryptedVaultV2;

/**
 * The plaintext payload encrypted inside the vault.
 * Only ever exists in memory while unlocked.
 */
export interface VaultPayload {
  version: 1;
  mnemonic: string;
  /** Optional BIP39 passphrase ("25th word"), encrypted inside the vault payload. */
  mnemonicPassphrase?: string;
  /** Selected derivation metadata for address/signing reconstruction. */
  derivation?: KaspaDerivationMeta;
  address: string;      // Derived receive address (index 0)
  network: "mainnet" | "testnet-10" | "testnet-11" | "testnet-12";
  derivationPath: string; // legacy: "m/44'/111'/0'"
  addressIndex: number;   // legacy: 0
}

/**
 * Runtime unlocked session.
 * Primary copy lives in memory; optional session-scoped cache may exist when
 * user enables keep-unlocked behavior.
 */
export interface UnlockedSession {
  mnemonic: string;
  mnemonicPassphrase?: string;
  derivation?: KaspaDerivationMeta;
  address: string;
  network: string;
  autoLockAt: number; // Unix ms — session expires at this timestamp
}
