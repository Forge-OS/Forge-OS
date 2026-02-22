#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

function usage() {
  console.log(
    [
      "Usage: node scripts/verify-audit-log.mjs --file <path> [--public-key <pemPath>] [--pin <sha256:...>] [--strict-signatures]",
      "",
      "Verifies:",
      "- JSONL parseability",
      "- append-only hash chain integrity (prev_record_hash -> record_hash)",
      "- decision audit signature payload hash + cryptographic signature (when key available)",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const out = {
    file: "",
    publicKeyPath: "",
    pins: [],
    strictSignatures: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i] || "");
    if (a === "--file") out.file = String(argv[++i] || "");
    else if (a === "--public-key") out.publicKeyPath = String(argv[++i] || "");
    else if (a === "--pin") out.pins.push(String(argv[++i] || ""));
    else if (a === "--strict-signatures") out.strictSignatures = true;
    else if (a === "--json") out.json = true;
    else if (a === "-h" || a === "--help") out.help = true;
    else throw new Error(`unknown_arg:${a}`);
  }
  return out;
}

function stableStringify(value) {
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

function b64u(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64uToBuf(v) {
  const base = String(v || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = base.length % 4 === 0 ? "" : "=".repeat(4 - (base.length % 4));
  return Buffer.from(base + pad, "base64");
}

function sha256B64u(input) {
  return b64u(crypto.createHash("sha256").update(input).digest());
}

function canonicalRecordHash(record) {
  return `sha256:${sha256B64u(stableStringify({ ...record, record_hash: undefined }))}`;
}

function signerFingerprint(publicKeyPem) {
  return `sha256:${sha256B64u(String(publicKeyPem || ""))}`;
}

function buildSigningPayloadFromRecord(record) {
  const audit = record?.audit || {};
  return {
    audit_record_version: String(audit?.audit_record_version || ""),
    hash_algo: String(audit?.hash_algo || ""),
    prompt_version: String(audit?.prompt_version || ""),
    ai_response_schema_version: String(audit?.ai_response_schema_version || ""),
    quant_feature_snapshot_hash: String(audit?.quant_feature_snapshot_hash || ""),
    decision_hash: String(audit?.decision_hash || ""),
    overlay_plan_reason: String(audit?.overlay_plan_reason || ""),
    engine_path: String(audit?.engine_path || ""),
    created_ts: Math.max(0, Math.round(Number(audit?.created_ts || 0))),
  };
}

function verifySignature(record, fallbackPublicKeyPem, pins) {
  const sig = record?.crypto_signature || {};
  const signer = record?.signer || {};
  const alg = String(signer?.alg || sig?.alg || "").toUpperCase();
  const signatureB64u = String(sig?.signature_b64u || sig?.signatureB64u || "").trim();
  const payloadHash = String(sig?.payload_hash_sha256_b64u || "").trim();
  const publicKeyPem = String(sig?.public_key_pem || fallbackPublicKeyPem || "");
  if (!signatureB64u) return { status: "missing_signature", verified: false };
  if (!publicKeyPem) return { status: "missing_public_key", verified: false };

  const fingerprint = signerFingerprint(publicKeyPem);
  const pinMatched = pins.length > 0 ? pins.includes(fingerprint) : null;
  if (pins.length > 0 && !pinMatched) {
    return { status: "unpinned", verified: false, fingerprint, pinMatched };
  }

  const signingPayload = buildSigningPayloadFromRecord(record);
  const canonicalPayload = stableStringify(signingPayload);
  const computedPayloadHash = sha256B64u(canonicalPayload);
  if (payloadHash && payloadHash !== computedPayloadHash) {
    return { status: "payload_hash_mismatch", verified: false, fingerprint, pinMatched };
  }

  const data = Buffer.from(canonicalPayload, "utf8");
  const sigBuf = b64uToBuf(signatureB64u);
  let ok = false;
  if (alg === "ED25519" || alg === "ED448") {
    ok = crypto.verify(null, data, publicKeyPem, sigBuf);
  } else if (alg === "RS256" || alg === "ES256") {
    ok = crypto.verify("sha256", data, publicKeyPem, sigBuf);
  } else {
    return { status: `unsupported_alg:${alg || "unknown"}`, verified: false, fingerprint, pinMatched };
  }
  return { status: ok ? "verified" : "invalid_signature", verified: ok, fingerprint, pinMatched };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.file) {
    usage();
    process.exit(args.help ? 0 : 1);
  }
  const filePath = path.resolve(process.cwd(), args.file);
  const fallbackPublicKeyPem = args.publicKeyPath ? fs.readFileSync(path.resolve(process.cwd(), args.publicKeyPath), "utf8") : "";
  const pins = args.pins.map((p) => String(p || "").trim()).filter(Boolean);

  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  let prevHash = null;
  const errors = [];
  const counters = {
    total: 0,
    chainValid: 0,
    chainInvalid: 0,
    sigVerified: 0,
    sigInvalid: 0,
    sigMissingKey: 0,
    sigUnsupported: 0,
    sigUnpinned: 0,
  };

  for (let i = 0; i < lines.length; i += 1) {
    counters.total += 1;
    let rec;
    try {
      rec = JSON.parse(lines[i]);
    } catch (e) {
      counters.chainInvalid += 1;
      errors.push({ line: i + 1, type: "invalid_json", detail: String(e?.message || e) });
      continue;
    }

    const expectedPrev = prevHash || null;
    const actualPrev = rec?.prev_record_hash ?? null;
    const actualRecordHash = String(rec?.record_hash || "");
    const recomputed = canonicalRecordHash(rec);
    const chainOk = actualPrev === expectedPrev && actualRecordHash === recomputed;
    if (chainOk) counters.chainValid += 1;
    else {
      counters.chainInvalid += 1;
      errors.push({
        line: i + 1,
        type: "chain_mismatch",
        expectedPrev,
        actualPrev,
        expectedRecordHash: recomputed,
        actualRecordHash,
      });
    }
    prevHash = actualRecordHash || prevHash;

    const sigOut = verifySignature(rec, fallbackPublicKeyPem, pins);
    if (sigOut.verified) counters.sigVerified += 1;
    else if (String(sigOut.status).startsWith("unsupported_alg")) counters.sigUnsupported += 1;
    else if (sigOut.status === "missing_public_key") counters.sigMissingKey += 1;
    else if (sigOut.status === "unpinned") counters.sigUnpinned += 1;
    else counters.sigInvalid += 1;
    if (!sigOut.verified) {
      errors.push({ line: i + 1, type: "signature", status: sigOut.status, fingerprint: sigOut.fingerprint || null });
    }
  }

  const summary = {
    ok:
      counters.chainInvalid === 0 &&
      (args.strictSignatures ? counters.sigInvalid === 0 && counters.sigMissingKey === 0 && counters.sigUnsupported === 0 && counters.sigUnpinned === 0 : true),
    file: filePath,
    counters,
    lastRecordHash: prevHash,
    pinsConfigured: pins.length,
    strictSignatures: args.strictSignatures,
    errors: errors.slice(0, 50),
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`[audit-log:verify] file=${summary.file}`);
    console.log(`[audit-log:verify] records=${counters.total} chainValid=${counters.chainValid} chainInvalid=${counters.chainInvalid}`);
    console.log(
      `[audit-log:verify] sigVerified=${counters.sigVerified} sigInvalid=${counters.sigInvalid} missingKey=${counters.sigMissingKey} unsupported=${counters.sigUnsupported} unpinned=${counters.sigUnpinned}`
    );
    if (summary.lastRecordHash) console.log(`[audit-log:verify] lastRecordHash=${summary.lastRecordHash}`);
    if (errors.length) {
      console.log("[audit-log:verify] sample errors:");
      for (const e of errors.slice(0, 10)) console.log(`- line ${e.line} ${e.type}: ${JSON.stringify(e)}`);
    }
  }

  if (!summary.ok) process.exit(1);
}

try {
  main();
} catch (e) {
  console.error("[audit-log:verify] fatal:", e);
  process.exit(1);
}

