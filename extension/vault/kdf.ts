// Key derivation — PBKDF2-SHA-256 (v1) + Argon2id via hash-wasm (v2).
// PBKDF2 path retained for reading legacy v1 vaults.
// New vaults are created with Argon2id (64 MB, 3 iterations, 4 lanes).
// 600,000 iterations satisfies OWASP 2023 guidance for password-derived AES keys.
// Works across all browser extension contexts (popup, service worker, content).

const ITERATIONS = 600_000;
const KEY_USAGE_ENCRYPT: KeyUsage[] = ["encrypt", "decrypt"];

/**
 * Derive a 256-bit AES-GCM key from a password + salt.
 *
 * The returned CryptoKey is non-extractable and usable only for AES-GCM
 * encrypt/decrypt operations. It is never stored — only held in memory for
 * the duration of a single vault open/close operation.
 *
 * @param password  User password string (UTF-8 encoded internally).
 * @param salt      32-byte random salt stored with the vault blob.
 * @returns         Non-extractable AES-GCM CryptoKey.
 */
export async function deriveKey(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const enc = new TextEncoder();

  // Import raw password bytes as a PBKDF2 base key
  const passKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,           // not extractable
    ["deriveKey"],
  );

  // Derive the AES-256-GCM key
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new Uint8Array(salt),
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    passKey,
    { name: "AES-GCM", length: 256 },
    false,           // not extractable — key bytes never leave SubtleCrypto
    KEY_USAGE_ENCRYPT,
  );
}

/**
 * Generate cryptographically secure random bytes using the browser CSPRNG.
 */
export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

// ── Argon2id KDF (D2) ─────────────────────────────────────────────────────────

export interface ArgonParams {
  memoryMB: number;    // RAM cost in megabytes
  iterations: number;  // time cost (passes)
  parallelism: number; // lanes
  hashLength: number;  // output bytes (32 → 256-bit AES key)
}

export const DEFAULT_ARGON_PARAMS: ArgonParams = {
  memoryMB: 64,
  iterations: 3,
  parallelism: 4,
  hashLength: 32,
};

/**
 * Derive a 256-bit AES-GCM key from password + salt using Argon2id.
 * Requires hash-wasm (WASM-safe, no native bindings).
 */
export async function deriveKeyArgon2id(
  password: string,
  salt: Uint8Array,
  params: ArgonParams = DEFAULT_ARGON_PARAMS,
): Promise<CryptoKey> {
  const { argon2id } = await import("hash-wasm");
  const rawHex = await argon2id({
    password,
    salt,
    memorySize: params.memoryMB * 1024,
    iterations: params.iterations,
    parallelism: params.parallelism,
    hashLength: params.hashLength,
    outputType: "hex",
  });
  // Convert hex to bytes
  const raw = new Uint8Array(rawHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
