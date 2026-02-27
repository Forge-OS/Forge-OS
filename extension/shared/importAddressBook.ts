import {
  derivationChainLabel,
  formatKaspaDerivationPath,
  normalizeKaspaDerivation,
  type KaspaDerivationMeta,
} from "../../src/wallet/derivation";
import type { ManagedWalletImportCandidate } from "../../src/wallet/KaspaWalletManager";

const BOOK_KEY = "forgeos.import.addressbook.v1";
const SALT_KEY = "forgeos.import.addressbook.salt.v1";
const MAX_FINGERPRINTS = 32;
const MAX_CANDIDATES_PER_FINGERPRINT = 240;

type StoredImportCandidate = {
  address: string;
  network: string;
  derivation: KaspaDerivationMeta;
  derivationPath: string;
  chainLabel: "receive" | "change";
  createdAt: number;
  lastUsedAt: number;
};

type ImportAddressBook = Record<string, StoredImportCandidate[]>;

function localStore(): chrome.storage.LocalStorageArea {
  return chrome.storage.local;
}

function normalizePhrase(phrase: string): string {
  return String(phrase || "").trim().toLowerCase().split(/\s+/).join(" ");
}

function normalizePassphrase(passphrase?: string): string {
  return String(passphrase || "").trim();
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (!clean || clean.length % 2 !== 0) return new Uint8Array();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return out;
}

async function getRaw<T = any>(key: string): Promise<T | null> {
  return new Promise((resolve) => {
    localStore().get(key, (result) => resolve((result?.[key] ?? null) as T | null));
  });
}

async function setRaw<T = any>(key: string, value: T): Promise<void> {
  return new Promise((resolve) => {
    localStore().set({ [key]: value }, resolve);
  });
}

async function getOrCreateSalt(): Promise<Uint8Array> {
  const existing = await getRaw<string>(SALT_KEY);
  if (existing && typeof existing === "string") {
    const bytes = hexToBytes(existing);
    if (bytes.length > 0) return bytes;
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  await setRaw(SALT_KEY, bytesToHex(bytes));
  return bytes;
}

async function getBook(): Promise<ImportAddressBook> {
  const raw = await getRaw<ImportAddressBook>(BOOK_KEY);
  if (!raw || typeof raw !== "object") return {};
  return raw;
}

async function setBook(book: ImportAddressBook): Promise<void> {
  await setRaw(BOOK_KEY, book);
}

async function mnemonicFingerprint(phrase: string, passphrase?: string): Promise<string> {
  const salt = await getOrCreateSalt();
  const normalizedPhrase = normalizePhrase(phrase);
  const normalizedPassphrase = normalizePassphrase(passphrase);
  if (!normalizedPhrase) return "";
  const payload = new TextEncoder().encode(
    `${bytesToHex(salt)}\n${normalizedPhrase}\n${normalizedPassphrase}`,
  );
  const hash = await crypto.subtle.digest("SHA-256", payload);
  return bytesToHex(new Uint8Array(hash));
}

function toManagedCandidate(c: StoredImportCandidate): ManagedWalletImportCandidate {
  const derivation = normalizeKaspaDerivation(c.derivation);
  return {
    address: c.address,
    derivation,
    derivationPath: formatKaspaDerivationPath(derivation),
    chainLabel: derivationChainLabel(derivation.chain),
  };
}

function normalizeStoredCandidate(
  candidate: ManagedWalletImportCandidate,
  network: string,
  now: number,
): StoredImportCandidate {
  const derivation = normalizeKaspaDerivation(candidate.derivation);
  return {
    address: candidate.address,
    network,
    derivation,
    derivationPath: formatKaspaDerivationPath(derivation),
    chainLabel: derivationChainLabel(derivation.chain),
    createdAt: now,
    lastUsedAt: now,
  };
}

function dedupeCandidates(candidates: StoredImportCandidate[]): StoredImportCandidate[] {
  const map = new Map<string, StoredImportCandidate>();
  for (const c of candidates) {
    const key = `${c.network.toLowerCase()}|${c.address.toLowerCase()}|${c.derivationPath}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, c);
      continue;
    }
    map.set(key, {
      ...existing,
      lastUsedAt: Math.max(existing.lastUsedAt, c.lastUsedAt),
      createdAt: Math.min(existing.createdAt, c.createdAt),
    });
  }
  return [...map.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

function capBook(book: ImportAddressBook): ImportAddressBook {
  const entries = Object.entries(book).sort((a, b) => {
    const aLast = a[1]?.[0]?.lastUsedAt ?? 0;
    const bLast = b[1]?.[0]?.lastUsedAt ?? 0;
    return bLast - aLast;
  });
  return Object.fromEntries(entries.slice(0, MAX_FINGERPRINTS));
}

export async function loadRememberedImportCandidates(
  phrase: string,
  passphrase: string | undefined,
  network: string,
): Promise<ManagedWalletImportCandidate[]> {
  const fp = await mnemonicFingerprint(phrase, passphrase);
  if (!fp) return [];
  const book = await getBook();
  const list = (book[fp] ?? [])
    .filter((c) => c.network === network)
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  return list.map(toManagedCandidate);
}

export async function rememberImportCandidates(
  phrase: string,
  passphrase: string | undefined,
  network: string,
  candidates: ManagedWalletImportCandidate[],
): Promise<void> {
  const fp = await mnemonicFingerprint(phrase, passphrase);
  if (!fp || !candidates.length) return;

  const now = Date.now();
  const book = await getBook();
  const existing = book[fp] ?? [];
  const incoming = candidates.map((c) => normalizeStoredCandidate(c, network, now));
  const merged = dedupeCandidates([...incoming, ...existing]).slice(0, MAX_CANDIDATES_PER_FINGERPRINT);
  book[fp] = merged;
  await setBook(capBook(book));
}

export async function rememberSelectedImportCandidate(
  phrase: string,
  passphrase: string | undefined,
  network: string,
  candidate: ManagedWalletImportCandidate,
): Promise<void> {
  await rememberImportCandidates(phrase, passphrase, network, [candidate]);
}

