import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { clearAuditSignerPublicKeyCache, verifyDecisionAuditCryptoSignature } from "../../src/runtime/auditCryptoVerify";

describe("auditCryptoVerify", () => {
  it("verifies a signed audit record and matches a pinned key fingerprint", async () => {
    clearAuditSignerPublicKeyCache();
    const { decision, publicPem, fingerprint } = buildSignedDecision();
    const out = await verifyDecisionAuditCryptoSignature(decision, {
      pinnedFingerprints: [fingerprint],
      requirePinned: true,
    });

    expect(out.status).toBe("verified");
    expect(out.verified).toBe(true);
    expect(out.pinMatched).toBe(true);
    expect(out.keyFingerprint).toBe(fingerprint);
    expect(out.alg).toBe("ED25519");
    expect(out.source).toBe("embedded");
    expect(publicPem).toContain("BEGIN PUBLIC KEY");
  });

  it("returns unpinned when key pinning is required and fingerprint does not match", async () => {
    clearAuditSignerPublicKeyCache();
    const { decision } = buildSignedDecision();
    const out = await verifyDecisionAuditCryptoSignature(decision, {
      pinnedFingerprints: ["sha256:not-the-right-pin"],
      requirePinned: true,
    });
    expect(out.status).toBe("unpinned");
    expect(out.verified).toBe(false);
    expect(out.pinMatched).toBe(false);
  });

  it("detects invalid signatures", async () => {
    clearAuditSignerPublicKeyCache();
    const { decision } = buildSignedDecision();
    decision.audit_record.decision_hash = "fnv1a32/canonical-json:tampered";
    const out = await verifyDecisionAuditCryptoSignature(decision);
    expect(["invalid", "error"]).toContain(out.status);
  });
});

function buildSignedDecision() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  const signingPayload = {
    audit_record_version: "forgeos.decision.audit.v1",
    hash_algo: "fnv1a32/canonical-json",
    prompt_version: "forgeos.quant.overlay.prompt.v1",
    ai_response_schema_version: "forgeos.ai.decision.schema.v1",
    quant_feature_snapshot_hash: "fnv1a32/canonical-json:abc12345",
    decision_hash: "fnv1a32/canonical-json:def67890",
    overlay_plan_reason: "ai_overlay_mode_always",
    engine_path: "hybrid-ai",
    created_ts: 1710000000000,
  };
  const canonicalPayload = stableStringify(signingPayload);
  const sig = crypto.sign(null, Buffer.from(canonicalPayload, "utf8"), privateKey);
  const sigB64u = toB64u(sig);
  const payloadHash = toB64u(crypto.createHash("sha256").update(canonicalPayload).digest());
  const fingerprint = `sha256:${toB64u(crypto.createHash("sha256").update(publicPem).digest())}`;

  const decision = {
    action: "ACCUMULATE",
    confidence_score: 0.81,
    audit_record: {
      ...signingPayload,
      audit_sig: "fnv1a32/canonical-json:localsig",
      crypto_signature: {
        status: "signed",
        alg: "Ed25519",
        key_id: "test-ed25519",
        sig_b64u: sigB64u,
        payload_hash_sha256_b64u: payloadHash,
        public_key_pem: publicPem,
        signer: "audit-signer",
        signed_ts: 1710000000100,
      },
    },
  };
  return { decision, publicPem, fingerprint };
}

function toB64u(buf: Uint8Array | Buffer) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
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

