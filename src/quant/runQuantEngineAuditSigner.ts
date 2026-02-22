import { toFinite } from "./math";
import {
  AUDIT_HASH_ALGO,
  buildAuditSigningPayloadFromRecord,
} from "./runQuantEngineAudit";
import { RUN_QUANT_ENGINE_CONFIG as CFG } from "./runQuantEngineConfig";

function auditSignerHeaders() {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (CFG.auditSignerToken) headers.Authorization = `Bearer ${CFG.auditSignerToken}`;
  return headers;
}

export async function maybeAttachCryptographicAuditSignature(decision: any) {
  const auditRecord = decision?.audit_record;
  if (!auditRecord || !CFG.auditSignerUrl) return decision;
  const signingPayload = buildAuditSigningPayloadFromRecord(auditRecord, {
    decisionAuditRecordVersion: CFG.decisionAuditRecordVersion,
    auditHashAlgo: AUDIT_HASH_ALGO,
    aiPromptVersion: CFG.aiPromptVersion,
    aiResponseSchemaVersion: CFG.aiResponseSchemaVersion,
  });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CFG.auditSignerTimeoutMs);
  try {
    const res = await fetch(CFG.auditSignerUrl, {
      method: "POST",
      headers: auditSignerHeaders(),
      body: JSON.stringify({ signingPayload }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(String(data?.error?.message || `audit_signer_${res.status || "failed"}`));
    }
    const sig = data?.signature && typeof data.signature === "object" ? data.signature : data;
    const cryptoSignature = {
      status: "signed",
      alg: String(sig?.alg || sig?.algorithm || "unknown").slice(0, 80),
      key_id: String(sig?.keyId || sig?.key_id || "").slice(0, 160),
      sig_b64u: String(sig?.signatureB64u || sig?.signature || sig?.sig_b64u || "").slice(0, 600),
      payload_hash_sha256_b64u: String(sig?.payloadHashSha256B64u || sig?.payload_hash_sha256_b64u || "").slice(0, 160),
      signer: String(sig?.signer || "audit-signer").slice(0, 80),
      signed_ts: Math.max(0, Math.round(toFinite(sig?.signedAt ?? sig?.signed_ts, Date.now()))),
      signing_latency_ms: Math.max(0, Math.round(toFinite(sig?.signingLatencyMs ?? sig?.signing_latency_ms, 0))),
      public_key_pem:
        typeof sig?.publicKeyPem === "string"
          ? sig.publicKeyPem.slice(0, 4000)
          : (typeof sig?.public_key_pem === "string" ? sig.public_key_pem.slice(0, 4000) : undefined),
    };
    return {
      ...decision,
      audit_record: {
        ...auditRecord,
        crypto_signature: cryptoSignature,
      },
    };
  } catch (err: any) {
    const message =
      err?.name === "AbortError"
        ? `audit_signer_timeout_${CFG.auditSignerTimeoutMs}ms`
        : String(err?.message || "audit_signer_failed");
    if (CFG.auditSignerRequired) {
      throw new Error(message);
    }
    return {
      ...decision,
      audit_record: {
        ...auditRecord,
        crypto_signature: {
          status: "error",
          signer: "audit-signer",
          error: message.slice(0, 240),
        },
      },
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

