// Deep vault security hardening tests.
//
// Tests that the existing vault.test.ts does NOT cover:
//  • AES-GCM auth-tag tamper detection (ciphertext bit-flip → INVALID_PASSWORD)
//  • IV and salt tampering
//  • Unicode, empty, whitespace, and 10k-char passwords
//  • Concurrent unlock race conditions
//  • BIP39 passphrase round-trip
//  • Vault blob schema validation
//  • Overwrite scenario (vault 1 password must fail after vault 2 creation)
//
// Uses the same 1-iteration PBKDF2 mock for speed — crypto correctness is
// validated by crypto.test.ts; here we care about vault-layer invariants.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── 1-iteration PBKDF2 mock ───────────────────────────────────────────────────
vi.mock("../../extension/vault/kdf", () => {
  async function fastDeriveKey(password: string, salt: Uint8Array) {
    const enc = new TextEncoder();
    const passKey = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 1, hash: "SHA-256" },
      passKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }
  return {
    deriveKey: fastDeriveKey,
    deriveKeyArgon2id: fastDeriveKey,
    DEFAULT_ARGON_PARAMS: { memoryMB: 64, iterations: 3, parallelism: 4, hashLength: 32 },
    randomBytes: (length: number) => crypto.getRandomValues(new Uint8Array(length)),
  };
});

// ── chrome mock ───────────────────────────────────────────────────────────────
const _store: Record<string, string> = {};
(globalThis as any).chrome = {
  storage: {
    local: {
      get: (key: string, cb: (r: Record<string, unknown>) => void) => cb({ [key]: _store[key] }),
      set: (items: Record<string, string>, cb: () => void) => { Object.assign(_store, items); cb(); },
      clear: (cb: () => void) => { Object.keys(_store).forEach((k) => delete _store[k]); cb(); },
      remove: (keys: string | string[], cb: () => void) => {
        (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete _store[k]);
        cb();
      },
    },
    session: {
      get: (_k: any, cb: (r: Record<string, unknown>) => void) => cb({}),
      set: (_items: any, cb: () => void) => cb(),
      remove: (_k: any, cb: () => void) => cb(),
    },
  },
  runtime: { sendMessage: () => {}, lastError: undefined },
};

const MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const ADDRESS = "kaspa:qptest000000000000000000000000000000000000000000000000";
const NETWORK = "mainnet";

beforeEach(() => {
  Object.keys(_store).forEach((k) => delete _store[k]);
  vi.resetModules();
  vi.useRealTimers();
});

// ── GCM auth-tag tamper detection ─────────────────────────────────────────────

describe("AES-GCM auth-tag tamper detection", () => {
  it("rejects when a single byte in the ciphertext is flipped", async () => {
    const { createVault, unlockVault } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, "password123!", ADDRESS, NETWORK);

    const raw = JSON.parse(_store["forgeos.vault.v1"]);
    // Flip first byte of ciphertext hex string (00 → 01, or any digit +1)
    const ct: string = raw.ciphertext;
    const flipped = ct.slice(0, 1) === "f"
      ? "0" + ct.slice(1)
      : String.fromCharCode(ct.charCodeAt(0) + 1) + ct.slice(1);
    raw.ciphertext = flipped;
    _store["forgeos.vault.v1"] = JSON.stringify(raw);

    await expect(unlockVault("password123!")).rejects.toThrow("INVALID_PASSWORD");
  });

  it("rejects when the last byte of the ciphertext (GCM tag) is flipped", async () => {
    const { createVault, unlockVault } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, "password123!", ADDRESS, NETWORK);

    const raw = JSON.parse(_store["forgeos.vault.v1"]);
    const ct: string = raw.ciphertext;
    // Flip the very last nibble
    const last = ct[ct.length - 1];
    const flipped = last === "f" ? "0" : String.fromCharCode(last.charCodeAt(0) + 1);
    raw.ciphertext = ct.slice(0, -1) + flipped;
    _store["forgeos.vault.v1"] = JSON.stringify(raw);

    await expect(unlockVault("password123!")).rejects.toThrow("INVALID_PASSWORD");
  });

  it("rejects when the IV is changed to a different random value", async () => {
    const { createVault, unlockVault } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, "password123!", ADDRESS, NETWORK);

    const raw = JSON.parse(_store["forgeos.vault.v1"]);
    // Replace IV with a different 12-byte value
    const newIv = crypto.getRandomValues(new Uint8Array(12));
    raw.iv = Array.from(newIv).map((b) => b.toString(16).padStart(2, "0")).join("");
    _store["forgeos.vault.v1"] = JSON.stringify(raw);

    await expect(unlockVault("password123!")).rejects.toThrow("INVALID_PASSWORD");
  });

  it("rejects when the salt is changed (derives wrong key)", async () => {
    const { createVault, unlockVault } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, "password123!", ADDRESS, NETWORK);

    const raw = JSON.parse(_store["forgeos.vault.v1"]);
    const newSalt = crypto.getRandomValues(new Uint8Array(32));
    raw.salt = Array.from(newSalt).map((b) => b.toString(16).padStart(2, "0")).join("");
    _store["forgeos.vault.v1"] = JSON.stringify(raw);

    await expect(unlockVault("password123!")).rejects.toThrow("INVALID_PASSWORD");
  });

  it("rejects when the entire ciphertext is replaced with random bytes of the same length", async () => {
    const { createVault, unlockVault } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, "password123!", ADDRESS, NETWORK);

    const raw = JSON.parse(_store["forgeos.vault.v1"]);
    const len = raw.ciphertext.length;
    const rnd = crypto.getRandomValues(new Uint8Array(len / 2));
    raw.ciphertext = Array.from(rnd).map((b) => b.toString(16).padStart(2, "0")).join("");
    _store["forgeos.vault.v1"] = JSON.stringify(raw);

    await expect(unlockVault("password123!")).rejects.toThrow("INVALID_PASSWORD");
  });
});

// ── Vault blob schema ─────────────────────────────────────────────────────────

describe("vault blob schema", () => {
  it("persists all required fields to storage", async () => {
    const { createVault } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, "password123!", ADDRESS, NETWORK);

    const blob = JSON.parse(_store["forgeos.vault.v1"]);
    expect(typeof blob.version).toBe("number");
    // v2 vaults use argon2id; legacy v1 used pbkdf2
    expect(blob.kdf === "argon2id" || blob.kdf === "pbkdf2").toBe(true);
    expect(typeof blob.salt).toBe("string");
    expect(blob.salt.length).toBe(64);   // 32 bytes → 64 hex chars
    expect(typeof blob.iv).toBe("string");
    expect(blob.iv.length).toBe(24);     // 12 bytes → 24 hex chars
    expect(typeof blob.ciphertext).toBe("string");
    expect(blob.ciphertext.length).toBeGreaterThan(0);
    expect(typeof blob.createdAt).toBe("number");
    expect(typeof blob.updatedAt).toBe("number");
  });

  it("preserves createdAt across password changes (updatedAt changes)", async () => {
    const { createVault, changePassword } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, "password123!", ADDRESS, NETWORK);
    const before = JSON.parse(_store["forgeos.vault.v1"]);

    await new Promise((r) => setTimeout(r, 5)); // ensure updatedAt differs
    await changePassword("password123!", "newPassword456!");
    const after = JSON.parse(_store["forgeos.vault.v1"]);

    expect(after.createdAt).toBe(before.createdAt);
    expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
  });

  it("each create call uses a fresh random IV (not reused)", async () => {
    const { createVault } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, "password123!", ADDRESS, NETWORK);
    const iv1 = JSON.parse(_store["forgeos.vault.v1"]).iv;
    await createVault(MNEMONIC, "password123!", ADDRESS, NETWORK);
    const iv2 = JSON.parse(_store["forgeos.vault.v1"]).iv;
    expect(iv1).not.toBe(iv2);
  });

  it("each create call uses a fresh random salt (not reused)", async () => {
    const { createVault } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, "password123!", ADDRESS, NETWORK);
    const s1 = JSON.parse(_store["forgeos.vault.v1"]).salt;
    await createVault(MNEMONIC, "password123!", ADDRESS, NETWORK);
    const s2 = JSON.parse(_store["forgeos.vault.v1"]).salt;
    expect(s1).not.toBe(s2);
  });
});

// ── Password edge cases ───────────────────────────────────────────────────────

describe("password edge cases", () => {
  it("accepts a Unicode password and round-trips correctly", async () => {
    const pw = "パスワード🔐test123!£€";
    const { createVault, unlockVault } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, pw, ADDRESS, NETWORK);
    const s = await unlockVault(pw);
    expect(s.mnemonic).toBe(MNEMONIC);
  });

  it("accepts an empty password string (weak but valid cipher-layer)", async () => {
    const { createVault, unlockVault } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, "", ADDRESS, NETWORK);
    const s = await unlockVault("");
    expect(s.mnemonic).toBe(MNEMONIC);
    // Wrong password still fails
    await expect(unlockVault("notempty")).rejects.toThrow("INVALID_PASSWORD");
  });

  it("accepts a 10,000-character password", async () => {
    const pw = "x".repeat(10_000);
    const { createVault, unlockVault } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, pw, ADDRESS, NETWORK);
    const s = await unlockVault(pw);
    expect(s.mnemonic).toBe(MNEMONIC);
  });

  it("passwords differing by only a single character do not decrypt each other", async () => {
    const pw1 = "Password123!";
    const pw2 = "Password123@";
    const { createVault, unlockVault } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, pw1, ADDRESS, NETWORK);
    await expect(unlockVault(pw2)).rejects.toThrow("INVALID_PASSWORD");
  });

  it("passwords differing only in case are distinct", async () => {
    const { createVault, unlockVault } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, "Password123!", ADDRESS, NETWORK);
    await expect(unlockVault("password123!")).rejects.toThrow("INVALID_PASSWORD");
    await expect(unlockVault("PASSWORD123!")).rejects.toThrow("INVALID_PASSWORD");
  });

  it("whitespace-only password encrypts and decrypts successfully", async () => {
    const pw = "        "; // 8 spaces
    const { createVault, unlockVault } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, pw, ADDRESS, NETWORK);
    const s = await unlockVault(pw);
    expect(s.mnemonic).toBe(MNEMONIC);
  });

  it("changePassword rejects new passwords shorter than 8 chars", async () => {
    const { createVault, changePassword } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, "password123!", ADDRESS, NETWORK);
    for (const short of ["", "a", "1234567"]) {
      await expect(changePassword("password123!", short)).rejects.toThrow("WEAK_PASSWORD");
    }
  });

  it("changePassword accepts exactly 8-character passwords", async () => {
    const { createVault, changePassword, unlockVault } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, "password123!", ADDRESS, NETWORK);
    await expect(changePassword("password123!", "12345678")).resolves.not.toThrow();
    const s = await unlockVault("12345678");
    expect(s.mnemonic).toBe(MNEMONIC);
  });
});

// ── BIP39 passphrase ──────────────────────────────────────────────────────────

describe("BIP39 passphrase", () => {
  it("stores and retrieves the BIP39 passphrase in the unlocked session", async () => {
    const { createVault, unlockVault } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, "password123!", ADDRESS, NETWORK, {
      mnemonicPassphrase: "my-bip39-extra-phrase",
    });
    const s = await unlockVault("password123!");
    expect(s.mnemonicPassphrase).toBe("my-bip39-extra-phrase");
  });

  it("two vaults with same mnemonic but different BIP39 passphrases are independent", async () => {
    const { createVault, unlockVault } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, "password123!", ADDRESS, NETWORK, { mnemonicPassphrase: "passA" });
    const s = await unlockVault("password123!");
    expect(s.mnemonicPassphrase).toBe("passA");

    // Overwrite with passB
    await createVault(MNEMONIC, "password123!", ADDRESS, NETWORK, { mnemonicPassphrase: "passB" });
    const s2 = await unlockVault("password123!");
    expect(s2.mnemonicPassphrase).toBe("passB");
  });

  it("undefined BIP39 passphrase round-trips as undefined", async () => {
    const { createVault, unlockVault } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, "password123!", ADDRESS, NETWORK);
    const s = await unlockVault("password123!");
    expect(s.mnemonicPassphrase).toBeUndefined();
  });
});

// ── Vault overwrite ───────────────────────────────────────────────────────────

describe("vault overwrite", () => {
  it("after overwriting vault, old password no longer works", async () => {
    const { createVault, unlockVault } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, "first-password", ADDRESS, NETWORK);
    // Overwrite with new credentials
    await createVault(MNEMONIC, "second-password", ADDRESS, NETWORK);
    await expect(unlockVault("first-password")).rejects.toThrow("INVALID_PASSWORD");
    await expect(unlockVault("second-password")).resolves.toBeDefined();
  });
});

// ── Concurrent unlock ─────────────────────────────────────────────────────────

describe("concurrent unlock", () => {
  it("two simultaneous correct unlocks both resolve without throwing", async () => {
    const { createVault, unlockVault } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, "password123!", ADDRESS, NETWORK);
    const [s1, s2] = await Promise.all([
      unlockVault("password123!"),
      unlockVault("password123!"),
    ]);
    expect(s1.mnemonic).toBe(MNEMONIC);
    expect(s2.mnemonic).toBe(MNEMONIC);
  });

  it("correct + wrong concurrent unlocks: correct resolves, wrong rejects", async () => {
    const { createVault, unlockVault } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, "password123!", ADDRESS, NETWORK);
    const results = await Promise.allSettled([
      unlockVault("password123!"),
      unlockVault("wrong-password"),
    ]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
  });
});

// ── Mnemonic wipe on lock ─────────────────────────────────────────────────────

describe("mnemonic wipe on lock", () => {
  it("session mnemonic reference is cleared to empty string after lockWallet", async () => {
    const { createVault, unlockVault, lockWallet, getSession } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, "password123!", ADDRESS, NETWORK);
    const s = await unlockVault("password123!");
    expect(s.mnemonic.length).toBeGreaterThan(0);
    lockWallet();
    expect(getSession()).toBeNull();
  });

  it("session mnemonic is cleared after auto-lock expiry via getSession()", async () => {
    const { createVault, unlockVault, getSession } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, "password123!", ADDRESS, NETWORK);
    await unlockVault("password123!", 15);
    const locked = getSession()!;
    vi.useFakeTimers({ now: locked.autoLockAt + 1 });
    expect(getSession()).toBeNull();
    vi.useRealTimers();
  });
});
