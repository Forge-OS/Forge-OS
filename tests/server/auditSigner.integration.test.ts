import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { getFreePort, httpJson, spawnNodeProcess, stopProcess, waitForHttp } from "./helpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

describe("audit signer service", () => {
  const children: Array<ReturnType<typeof spawnNodeProcess>> = [];

  afterEach(async () => {
    await Promise.all(children.map((c) => stopProcess(c.child)));
    children.length = 0;
  });

  it("signs canonical decision audit payloads with a server-side Ed25519 key", async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const publicPem = publicKey.export({ format: "pem", type: "spki" }).toString();
    const port = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeos-audit-signer-"));
    const appendLogPath = path.join(tmpDir, "decision-audit.jsonl");

    const proc = spawnNodeProcess(["server/audit-signer/index.mjs"], {
      cwd: repoRoot,
      env: {
        PORT: String(port),
        HOST: "127.0.0.1",
        AUDIT_SIGNER_PRIVATE_KEY_PEM: privatePem,
        AUDIT_SIGNER_KEY_ID: "test-ed25519",
        AUDIT_SIGNER_INCLUDE_PUBLIC_KEY: "true",
        AUDIT_SIGNER_APPEND_LOG_PATH: appendLogPath,
      },
    });
    children.push(proc);

    await waitForHttp(`http://127.0.0.1:${port}/health`);

    const payload = {
      audit_record_version: "forgeos.decision.audit.v1",
      hash_algo: "fnv1a32/canonical-json",
      prompt_version: "forgeos.quant.overlay.prompt.v1",
      ai_response_schema_version: "forgeos.ai.decision.schema.v1",
      quant_feature_snapshot_hash: "fnv1a32/canonical-json:abc12345",
      decision_hash: "fnv1a32/canonical-json:def67890",
      overlay_plan_reason: "ai_overlay_mode_always",
      engine_path: "hybrid-ai",
      created_ts: Date.now(),
    };

    const signRes = await httpJson(`http://127.0.0.1:${port}/v1/audit-sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signingPayload: payload }),
    });
    expect(signRes.res.status).toBe(200);
    expect(signRes.body?.ok).toBe(true);
    expect(signRes.body?.signature?.alg).toBe("Ed25519");
    expect(signRes.body?.signature?.keyId).toBe("test-ed25519");
    expect(String(signRes.body?.signature?.signatureB64u || "")).not.toBe("");

    const signatureB64u = String(signRes.body.signature.signatureB64u);
    const sigBuf = b64uToBuffer(signatureB64u);

    const canonical = stableStringify(payload);
    const verified = crypto.verify(null, Buffer.from(canonical, "utf8"), publicPem, sigBuf);
    expect(verified).toBe(true);

    const publicKeyRes = await httpJson(`http://127.0.0.1:${port}/v1/public-key`);
    expect(publicKeyRes.res.status).toBe(200);
    expect(String(publicKeyRes.body?.key?.publicKeyPem || "")).toContain("BEGIN PUBLIC KEY");

    const auditLogRes = await fetch(`http://127.0.0.1:${port}/v1/audit-log?limit=10`);
    expect(auditLogRes.status).toBe(200);
    const auditLogText = await auditLogRes.text();
    expect(auditLogText).toContain("\"kind\":\"forgeos.decision.audit.signed\"");
    expect(auditLogText).toContain("\"decision_hash\":\"fnv1a32/canonical-json:def67890\"");
    expect(auditLogText).toContain("\"signature_b64u\"");
    expect(auditLogText).toContain("\"record_hash\"");
    expect(auditLogText).toContain("\"prev_record_hash\":null");
    expect(fs.existsSync(appendLogPath)).toBe(true);

    const metricsText = await fetch(`http://127.0.0.1:${port}/metrics`).then((r) => r.text());
    expect(metricsText).toContain("forgeos_audit_signer_sign_success_total 1");
    expect(metricsText).toContain("forgeos_audit_signer_append_log_writes_total 1");
    expect(metricsText).toContain("forgeos_audit_signer_mode 1");
    expect(publicPem).toContain("BEGIN PUBLIC KEY");
  }, 15_000);
});

function b64uToBuffer(v: string) {
  const base = String(v || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = base.length % 4 === 0 ? "" : "=".repeat(4 - (base.length % 4));
  return Buffer.from(base + pad, "base64");
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
