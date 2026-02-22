const env = import.meta.env;

const AUDIT_SIGNER_SIGN_URL = String(env.VITE_DECISION_AUDIT_SIGNER_URL || "").trim();
const AUDIT_SIGNER_PUBLIC_KEY_URL = String(env.VITE_DECISION_AUDIT_SIGNER_PUBLIC_KEY_URL || "").trim();
const AUDIT_SIGNER_TOKEN = String(env.VITE_DECISION_AUDIT_SIGNER_TOKEN || "").trim();
const AUDIT_SIGNER_PUBLIC_KEY_CACHE_TTL_MS = Math.max(
  5_000,
  Number(env.VITE_DECISION_AUDIT_SIGNER_PUBLIC_KEY_CACHE_TTL_MS || 300_000)
);
const PINNED_KEY_FINGERPRINTS = String(env.VITE_DECISION_AUDIT_SIGNER_PINNED_FINGERPRINTS || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
const REQUIRE_PINNED_KEY = /^(1|true|yes)$/i.test(String(env.VITE_DECISION_AUDIT_SIGNER_REQUIRE_PINNED || "false"));

type VerificationStatus =
  | "verified"
  | "invalid"
  | "unpinned"
  | "unsupported"
  | "missing_signature"
  | "missing_payload"
  | "error";

export type AuditCryptoVerificationResult = {
  status: VerificationStatus;
  verified: boolean;
  pinMatched: boolean | null;
  pinsConfigured: boolean;
  keyFingerprint: string | null;
  keyId: string | null;
  alg: string | null;
  source: "embedded" | "fetched" | "none";
  detail?: string;
  verifiedAtTs: number;
};

type VerifyOptions = {
  pinnedFingerprints?: string[];
  requirePinned?: boolean;
  publicKeyUrl?: string;
  token?: string;
};

type CachedPublicKey = {
  ts: number;
  keyId: string | null;
  alg: string | null;
  publicKeyPem: string;
  fingerprint: string | null;
};

let publicKeyCache: CachedPublicKey | null = null;
let publicKeyFetchInFlight: Promise<CachedPublicKey | null> | null = null;

function nowMs() {
  return Date.now();
}

function stableStringify(value: any): string {
  if (value == null) return "null";
  const t = typeof value;
  if (t === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (t === "boolean") return value ? "true" : "false";
  if (t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  if (t === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => typeof v !== "undefined")
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return "null";
}

function buildAuditSigningPayload(auditRecord: any) {
  return {
    audit_record_version: String(auditRecord?.audit_record_version || ""),
    hash_algo: String(auditRecord?.hash_algo || ""),
    prompt_version: String(auditRecord?.prompt_version || ""),
    ai_response_schema_version: String(auditRecord?.ai_response_schema_version || ""),
    quant_feature_snapshot_hash: String(auditRecord?.quant_feature_snapshot_hash || ""),
    decision_hash: String(auditRecord?.decision_hash || ""),
    overlay_plan_reason: String(auditRecord?.overlay_plan_reason || ""),
    engine_path: String(auditRecord?.engine_path || ""),
    created_ts: Math.max(0, Math.round(Number(auditRecord?.created_ts || 0))),
  };
}

function inferPublicKeyUrl() {
  if (AUDIT_SIGNER_PUBLIC_KEY_URL) return AUDIT_SIGNER_PUBLIC_KEY_URL;
  if (!AUDIT_SIGNER_SIGN_URL) return "";
  try {
    const url = new URL(AUDIT_SIGNER_SIGN_URL);
    if (url.pathname.endsWith("/v1/audit-sign")) {
      url.pathname = url.pathname.replace(/\/v1\/audit-sign$/, "/v1/public-key");
      return url.toString();
    }
    return "";
  } catch {
    return "";
  }
}

function b64uToBytes(raw: string) {
  const base = String(raw || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = base.length % 4 === 0 ? "" : "=".repeat(4 - (base.length % 4));
  const bin = atob(base + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64u(bytes: Uint8Array) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToSpkiBytes(pem: string) {
  const body = String(pem || "")
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  return b64uToBytes(body.replace(/\+/g, "-").replace(/\//g, "_"));
}

async function sha256B64uUtf8(text: string) {
  const data = new TextEncoder().encode(String(text || ""));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return bytesToB64u(digest);
}

async function signerPublicKeyFingerprint(publicKeyPem: string) {
  // Match server/audit-signer fingerprinting behavior (sha256 of the PEM string bytes).
  return `sha256:${await sha256B64uUtf8(String(publicKeyPem || ""))}`;
}

function normalizePins(rawPins?: string[]) {
  const src = Array.isArray(rawPins) ? rawPins : PINNED_KEY_FINGERPRINTS;
  return src.map((v) => String(v || "").trim()).filter(Boolean);
}

function normalizeAlg(algRaw: any) {
  return String(algRaw || "").trim().toUpperCase();
}

async function importVerifyKey(publicKeyPem: string, alg: string) {
  const spki = pemToSpkiBytes(publicKeyPem);
  if (alg === "ED25519") {
    return {
      key: await crypto.subtle.importKey("spki", spki, { name: "Ed25519" } as any, false, ["verify"]),
      verifyAlgo: { name: "Ed25519" } as any,
    };
  }
  if (alg === "ES256") {
    return {
      key: await crypto.subtle.importKey(
        "spki",
        spki,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"]
      ),
      verifyAlgo: { name: "ECDSA", hash: "SHA-256" },
    };
  }
  if (alg === "RS256") {
    return {
      key: await crypto.subtle.importKey(
        "spki",
        spki,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"]
      ),
      verifyAlgo: { name: "RSASSA-PKCS1-v1_5" },
    };
  }
  throw new Error(`unsupported_alg:${alg || "unknown"}`);
}

function cachedPublicKeyFresh() {
  return Boolean(publicKeyCache && nowMs() - publicKeyCache.ts < AUDIT_SIGNER_PUBLIC_KEY_CACHE_TTL_MS);
}

async function fetchSignerPublicKey(opts?: VerifyOptions): Promise<CachedPublicKey | null> {
  if (cachedPublicKeyFresh()) return publicKeyCache;
  if (publicKeyFetchInFlight) return publicKeyFetchInFlight;
  const url = String(opts?.publicKeyUrl || inferPublicKeyUrl()).trim();
  if (!url) return null;

  publicKeyFetchInFlight = (async () => {
    try {
      const headers: Record<string, string> = {};
      const token = String(opts?.token || AUDIT_SIGNER_TOKEN || "").trim();
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(url, { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return null;
      const key = data?.key && typeof data.key === "object" ? data.key : data;
      const publicKeyPem = String(key?.publicKeyPem || key?.public_key_pem || "");
      if (!publicKeyPem.trim()) return null;
      const cached: CachedPublicKey = {
        ts: nowMs(),
        keyId: key?.keyId ? String(key.keyId) : (key?.key_id ? String(key.key_id) : null),
        alg: key?.alg ? String(key.alg) : (key?.algorithm ? String(key.algorithm) : null),
        publicKeyPem,
        fingerprint:
          typeof key?.publicKeyFingerprint === "string"
            ? String(key.publicKeyFingerprint)
            : (typeof key?.public_key_fingerprint === "string"
              ? String(key.public_key_fingerprint)
              : await signerPublicKeyFingerprint(publicKeyPem)),
      };
      publicKeyCache = cached;
      return cached;
    } catch {
      return null;
    } finally {
      publicKeyFetchInFlight = null;
    }
  })();

  return publicKeyFetchInFlight;
}

function result(partial: Partial<AuditCryptoVerificationResult>): AuditCryptoVerificationResult {
  return {
    status: "error",
    verified: false,
    pinMatched: null,
    pinsConfigured: false,
    keyFingerprint: null,
    keyId: null,
    alg: null,
    source: "none",
    verifiedAtTs: nowMs(),
    ...partial,
  };
}

function hasWebCryptoVerify() {
  return Boolean(globalThis.crypto?.subtle && globalThis.TextEncoder && globalThis.atob && globalThis.btoa);
}

export async function verifyDecisionAuditCryptoSignature(decision: any, opts?: VerifyOptions): Promise<AuditCryptoVerificationResult> {
  if (!hasWebCryptoVerify()) {
    return result({ status: "unsupported", detail: "webcrypto_unavailable" });
  }
  const audit = decision?.audit_record;
  const cryptoSig = audit?.crypto_signature;
  if (!audit || !cryptoSig || String(cryptoSig?.status || "").toLowerCase() !== "signed") {
    return result({ status: "missing_signature", detail: "crypto_signature_not_signed" });
  }

  const sigB64u = String(cryptoSig?.sig_b64u || "").trim();
  if (!sigB64u) return result({ status: "missing_signature", detail: "sig_b64u_missing" });
  const payload = buildAuditSigningPayload(audit);
  if (!payload.decision_hash || !payload.quant_feature_snapshot_hash) {
    return result({ status: "missing_payload", detail: "audit_payload_missing_hashes" });
  }
  const canonicalPayload = stableStringify(payload);

  let publicKeyPem = String(cryptoSig?.public_key_pem || "");
  let keyFingerprint: string | null = null;
  let source: "embedded" | "fetched" | "none" = "none";
  let fetchedKey: CachedPublicKey | null = null;
  if (publicKeyPem.trim()) {
    source = "embedded";
    keyFingerprint = await signerPublicKeyFingerprint(publicKeyPem);
  } else {
    fetchedKey = await fetchSignerPublicKey(opts);
    if (!fetchedKey?.publicKeyPem) {
      return result({
        status: "error",
        detail: "public_key_not_available",
        keyId: String(cryptoSig?.key_id || "") || null,
        alg: String(cryptoSig?.alg || "") || null,
      });
    }
    publicKeyPem = fetchedKey.publicKeyPem;
    keyFingerprint = fetchedKey.fingerprint || (await signerPublicKeyFingerprint(publicKeyPem));
    source = "fetched";
  }

  const pins = normalizePins(opts?.pinnedFingerprints);
  const pinsConfigured = pins.length > 0;
  const pinMatched = pinsConfigured ? pins.includes(String(keyFingerprint || "")) : null;
  const requirePinned = opts?.requirePinned ?? REQUIRE_PINNED_KEY;
  if (requirePinned && pinsConfigured && !pinMatched) {
    return result({
      status: "unpinned",
      verified: false,
      pinMatched: false,
      pinsConfigured,
      keyFingerprint,
      keyId: String(cryptoSig?.key_id || fetchedKey?.keyId || "") || null,
      alg: String(cryptoSig?.alg || fetchedKey?.alg || "") || null,
      source,
      detail: "signer_key_not_pinned",
    });
  }

  try {
    const payloadHashExpected = String(cryptoSig?.payload_hash_sha256_b64u || "").trim();
    if (payloadHashExpected) {
      const payloadHashActual = await sha256B64uUtf8(canonicalPayload);
      if (payloadHashActual !== payloadHashExpected) {
        return result({
          status: "invalid",
          detail: "payload_hash_mismatch",
          keyFingerprint,
          keyId: String(cryptoSig?.key_id || fetchedKey?.keyId || "") || null,
          alg: String(cryptoSig?.alg || fetchedKey?.alg || "") || null,
          source,
          pinsConfigured,
          pinMatched,
        });
      }
    }

    const alg = normalizeAlg(cryptoSig?.alg || fetchedKey?.alg || "");
    const { key, verifyAlgo } = await importVerifyKey(publicKeyPem, alg);
    const ok = await crypto.subtle.verify(
      verifyAlgo,
      key,
      b64uToBytes(sigB64u),
      new TextEncoder().encode(canonicalPayload)
    );
    return result({
      status: ok ? "verified" : "invalid",
      verified: Boolean(ok),
      pinMatched,
      pinsConfigured,
      keyFingerprint,
      keyId: String(cryptoSig?.key_id || fetchedKey?.keyId || "") || null,
      alg: alg || null,
      source,
      detail: ok ? undefined : "signature_verify_failed",
    });
  } catch (err: any) {
    const message = String(err?.message || "verify_failed");
    if (/unsupported_alg/i.test(message)) {
      return result({
        status: "unsupported",
        detail: message,
        pinMatched,
        pinsConfigured,
        keyFingerprint,
        keyId: String(cryptoSig?.key_id || fetchedKey?.keyId || "") || null,
        alg: String(cryptoSig?.alg || fetchedKey?.alg || "") || null,
        source,
      });
    }
    return result({
      status: "error",
      detail: message,
      pinMatched,
      pinsConfigured,
      keyFingerprint,
      keyId: String(cryptoSig?.key_id || fetchedKey?.keyId || "") || null,
      alg: String(cryptoSig?.alg || fetchedKey?.alg || "") || null,
      source,
    });
  }
}

export function decisionAuditVerifyCacheKey(decision: any) {
  const audit = decision?.audit_record;
  const sig = audit?.crypto_signature;
  const decisionHash = String(audit?.decision_hash || "").trim();
  const sigB64u = String(sig?.sig_b64u || "").trim();
  const keyId = String(sig?.key_id || "").trim();
  if (!decisionHash || !sigB64u) return "";
  return `${decisionHash}|${keyId}|${sigB64u.slice(0, 48)}`;
}

export function clearAuditSignerPublicKeyCache() {
  publicKeyCache = null;
  publicKeyFetchInFlight = null;
}
