import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || 8797);
const HOST = String(process.env.HOST || "0.0.0.0");
const ALLOWED_ORIGINS = String(process.env.AUDIT_SIGNER_ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const AUTH_TOKENS = String(process.env.AUDIT_SIGNER_AUTH_TOKENS || process.env.AUDIT_SIGNER_AUTH_TOKEN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const REQUIRE_AUTH_FOR_READS = /^(1|true|yes)$/i.test(String(process.env.AUDIT_SIGNER_AUTH_READS || "false"));
const COMMAND = String(process.env.AUDIT_SIGNER_COMMAND || "").trim();
const COMMAND_TIMEOUT_MS = Math.max(500, Number(process.env.AUDIT_SIGNER_COMMAND_TIMEOUT_MS || 5000));
const KEY_ID = String(process.env.AUDIT_SIGNER_KEY_ID || "").trim();
const PRIVATE_KEY_PEM_ENV = String(process.env.AUDIT_SIGNER_PRIVATE_KEY_PEM || "");
const PRIVATE_KEY_PATH = String(process.env.AUDIT_SIGNER_PRIVATE_KEY_PATH || "").trim();
const INCLUDE_PUBLIC_KEY = /^(1|true|yes)$/i.test(String(process.env.AUDIT_SIGNER_INCLUDE_PUBLIC_KEY || "true"));
const APPEND_LOG_PATH = String(process.env.AUDIT_SIGNER_APPEND_LOG_PATH || "").trim();
const APPEND_LOG_MAX_EXPORT_LINES = Math.max(1, Number(process.env.AUDIT_SIGNER_APPEND_LOG_MAX_EXPORT_LINES || 2000));
const SIGNING_VERSION = "forgeos.audit.crypto.v1";
const APPEND_LOG_CHAIN_HASH_ALGO = "sha256/canonical-json";

let signerMode = "disabled";
let privateKeyObj = null;
let publicKeyPem = "";
let publicKeyFingerprint = "";
let resolvedKeyId = KEY_ID || "";
let localAlg = "";
let appendLogChainInitialized = false;
let appendLogLastRecordHash = "";
let appendLogWriteChain = Promise.resolve();

const metrics = {
  startedAtMs: Date.now(),
  httpRequestsTotal: 0,
  httpResponsesByRouteStatus: new Map(),
  authFailuresTotal: 0,
  signRequestsTotal: 0,
  signSuccessTotal: 0,
  signErrorsTotal: 0,
  commandExecTotal: 0,
  commandExecErrorsTotal: 0,
  appendLogWritesTotal: 0,
  appendLogWriteErrorsTotal: 0,
};

function nowMs() {
  return Date.now();
}

function inc(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

function resolveOrigin(req) {
  const origin = req.headers.origin || "*";
  if (ALLOWED_ORIGINS.includes("*")) return typeof origin === "string" ? origin : "*";
  return ALLOWED_ORIGINS.includes(String(origin)) ? String(origin) : "null";
}

function authEnabled() {
  return AUTH_TOKENS.length > 0;
}

function routeRequiresAuth(req, pathname) {
  if (!authEnabled()) return false;
  if (req.method === "OPTIONS") return false;
  if (req.method === "GET" && pathname === "/health") return false;
  if (req.method === "GET" && !REQUIRE_AUTH_FOR_READS) return false;
  return true;
}

function getAuthToken(req) {
  const authHeader = String(req.headers.authorization || "").trim();
  if (/^bearer\s+/i.test(authHeader)) return authHeader.replace(/^bearer\s+/i, "").trim();
  return String(req.headers["x-audit-signer-token"] || "").trim();
}

function json(res, status, body, origin = "*") {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Audit-Signer-Token",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function text(res, status, body, origin = "*") {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": origin,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk);
      if (raw.length > 1_000_000) {
        reject(new Error("payload_too_large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function recordHttp(routeKey, statusCode) {
  metrics.httpRequestsTotal += 1;
  inc(metrics.httpResponsesByRouteStatus, `${routeKey}|${statusCode}`);
}

function esc(v) {
  return String(v ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
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

function sha256B64u(input) {
  return b64u(crypto.createHash("sha256").update(input).digest());
}

function canonicalRecordHash(value) {
  return `sha256:${sha256B64u(stableStringify(value))}`;
}

function spkiFingerprint(publicKeyPemValue) {
  return `sha256:${sha256B64u(String(publicKeyPemValue || ""))}`;
}

function localSignerConfigured() {
  return Boolean(privateKeyObj);
}

function detectAlgForKey(keyObj) {
  const type = String(keyObj?.asymmetricKeyType || "").toLowerCase();
  if (type === "ed25519") return "Ed25519";
  if (type === "ed448") return "Ed448";
  if (type === "rsa" || type === "rsa-pss") return "RS256";
  if (type === "ec") return "ES256";
  return type || "unknown";
}

function signLocalCanonical(canonicalPayload) {
  if (!privateKeyObj) throw new Error("local_signer_not_configured");
  const data = Buffer.from(String(canonicalPayload || ""), "utf8");
  const keyType = String(privateKeyObj.asymmetricKeyType || "").toLowerCase();
  let sig;
  if (keyType === "ed25519" || keyType === "ed448") {
    sig = crypto.sign(null, data, privateKeyObj);
  } else {
    sig = crypto.sign("sha256", data, privateKeyObj);
  }
  return {
    signatureB64u: b64u(sig),
    alg: localAlg || detectAlgForKey(privateKeyObj),
    keyId: resolvedKeyId,
    publicKeyPem: INCLUDE_PUBLIC_KEY ? publicKeyPem : undefined,
  };
}

function execCommandJson(command, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    metrics.commandExecTotal += 1;
    const child = spawn("sh", ["-lc", command], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (err, out) => {
      if (settled) return;
      settled = true;
      try { clearTimeout(timer); } catch {}
      if (err) reject(err);
      else resolve(out);
    };
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("error", (e) => {
      metrics.commandExecErrorsTotal += 1;
      finish(new Error(`audit_signer_command_error:${String(e?.message || e)}`));
    });
    child.on("exit", (code) => {
      if (code !== 0) {
        metrics.commandExecErrorsTotal += 1;
        finish(new Error(`audit_signer_command_exit_${code}:${stderr.slice(0, 240)}`));
        return;
      }
      try {
        const parsed = stdout.trim() ? JSON.parse(stdout) : {};
        finish(null, parsed);
      } catch {
        metrics.commandExecErrorsTotal += 1;
        finish(new Error("audit_signer_command_invalid_json"));
      }
    });
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch {}
      metrics.commandExecErrorsTotal += 1;
      finish(new Error(`audit_signer_command_timeout_${timeoutMs}ms`));
    }, timeoutMs);
    try {
      child.stdin.write(JSON.stringify(input));
      child.stdin.end();
    } catch (e) {
      metrics.commandExecErrorsTotal += 1;
      finish(new Error(`audit_signer_command_stdin_failed:${String(e?.message || e)}`));
    }
  });
}

async function signCommandCanonical(canonicalPayload, signingPayload) {
  if (!COMMAND) throw new Error("command_signer_not_configured");
  const out = await execCommandJson(
    COMMAND,
    {
      kind: "forgeos.decision.audit.sign",
      version: SIGNING_VERSION,
      canonicalPayload,
      signingPayload,
      payloadHashSha256B64u: sha256B64u(canonicalPayload),
      ts: nowMs(),
    },
    COMMAND_TIMEOUT_MS
  );
  const signatureB64u =
    String(out?.signatureB64u || out?.signature || out?.sig_b64u || "").trim();
  if (!signatureB64u) throw new Error("audit_signer_command_missing_signature");
  return {
    signatureB64u,
    alg: String(out?.alg || out?.algorithm || "external").slice(0, 64),
    keyId: String(out?.keyId || out?.key_id || resolvedKeyId || "external").slice(0, 120),
    publicKeyPem: out?.publicKeyPem ? String(out.publicKeyPem).slice(0, 4000) : undefined,
    signer: "command",
  };
}

async function signDecisionAuditPayload(signingPayload) {
  const canonicalPayload = stableStringify(signingPayload);
  const payloadHashSha256B64u = sha256B64u(canonicalPayload);
  const started = nowMs();
  let signed;
  if (COMMAND) {
    signed = await signCommandCanonical(canonicalPayload, signingPayload);
  } else if (localSignerConfigured()) {
    signed = { ...signLocalCanonical(canonicalPayload), signer: "local-key" };
  } else {
    throw new Error("audit_signer_not_configured");
  }
  return {
    ...signed,
    payloadHashSha256B64u,
    payloadCanonicalLength: Buffer.byteLength(canonicalPayload, "utf8"),
    signedAt: nowMs(),
    signingLatencyMs: Math.max(0, nowMs() - started),
    signingVersion: SIGNING_VERSION,
  };
}

function normalizeSignRequest(body) {
  const payload = body?.signingPayload && typeof body.signingPayload === "object"
    ? body.signingPayload
    : (body?.payload && typeof body.payload === "object" ? body.payload : null);
  if (!payload) throw new Error("signing_payload_required");

  const normalized = {
    audit_record_version: String(payload.audit_record_version || "").slice(0, 80),
    hash_algo: String(payload.hash_algo || "").slice(0, 80),
    prompt_version: String(payload.prompt_version || "").slice(0, 120),
    ai_response_schema_version: String(payload.ai_response_schema_version || "").slice(0, 120),
    quant_feature_snapshot_hash: String(payload.quant_feature_snapshot_hash || "").slice(0, 160),
    decision_hash: String(payload.decision_hash || "").slice(0, 160),
    overlay_plan_reason: String(payload.overlay_plan_reason || "").slice(0, 200),
    engine_path: String(payload.engine_path || "").slice(0, 80),
    created_ts: Math.max(0, Math.round(Number(payload.created_ts || 0))),
  };
  if (!normalized.decision_hash || !normalized.quant_feature_snapshot_hash) {
    throw new Error("decision_hash_and_quant_feature_snapshot_hash_required");
  }
  return normalized;
}

function appendLogEnabled() {
  return Boolean(APPEND_LOG_PATH);
}

function buildAppendLogRecord(signingPayload, signature) {
  return {
    kind: "forgeos.decision.audit.signed",
    version: SIGNING_VERSION,
    ts: nowMs(),
    signer: {
      mode: signerMode,
      keyId: String(signature?.keyId || signature?.key_id || resolvedKeyId || "").slice(0, 160),
      alg: String(signature?.alg || signature?.algorithm || localAlg || "unknown").slice(0, 80),
      signer: String(signature?.signer || signerMode).slice(0, 80),
    },
    audit: {
      audit_record_version: String(signingPayload?.audit_record_version || "").slice(0, 80),
      hash_algo: String(signingPayload?.hash_algo || "").slice(0, 80),
      prompt_version: String(signingPayload?.prompt_version || "").slice(0, 120),
      ai_response_schema_version: String(signingPayload?.ai_response_schema_version || "").slice(0, 120),
      quant_feature_snapshot_hash: String(signingPayload?.quant_feature_snapshot_hash || "").slice(0, 160),
      decision_hash: String(signingPayload?.decision_hash || "").slice(0, 160),
      overlay_plan_reason: String(signingPayload?.overlay_plan_reason || "").slice(0, 200),
      engine_path: String(signingPayload?.engine_path || "").slice(0, 80),
      created_ts: Math.max(0, Math.round(Number(signingPayload?.created_ts || 0))),
    },
    crypto_signature: {
      payload_hash_sha256_b64u: String(signature?.payloadHashSha256B64u || signature?.payload_hash_sha256_b64u || "").slice(0, 160),
      signature_b64u: String(signature?.signatureB64u || signature?.signature || signature?.sig_b64u || "").slice(0, 1200),
      signedAt: Math.max(0, Math.round(Number(signature?.signedAt || signature?.signed_ts || 0))),
      signingLatencyMs: Math.max(0, Math.round(Number(signature?.signingLatencyMs || signature?.signing_latency_ms || 0))),
      public_key_pem:
        typeof signature?.publicKeyPem === "string"
          ? signature.publicKeyPem
          : (typeof signature?.public_key_pem === "string" ? signature.public_key_pem : undefined),
      public_key_fingerprint:
        typeof signature?.publicKeyPem === "string"
          ? spkiFingerprint(signature.publicKeyPem)
          : (typeof signature?.public_key_pem === "string" ? spkiFingerprint(signature.public_key_pem) : undefined),
    },
  };
}

async function initAppendLogChainState() {
  if (appendLogChainInitialized || !appendLogEnabled()) return;
  appendLogChainInitialized = true;
  appendLogLastRecordHash = "";
  try {
    const raw = await fs.promises.readFile(APPEND_LOG_PATH, "utf8");
    const lastLine = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-1)[0];
    if (!lastLine) return;
    const parsed = JSON.parse(lastLine);
    if (typeof parsed?.record_hash === "string" && parsed.record_hash.trim()) {
      appendLogLastRecordHash = parsed.record_hash.trim();
    }
  } catch {
    // Ignore missing/invalid append log on startup; next write starts a new chain head.
  }
}

function buildChainedAppendLogRecord(record, prevRecordHash) {
  const base = {
    ...record,
    record_hash_algo: APPEND_LOG_CHAIN_HASH_ALGO,
    prev_record_hash: prevRecordHash || null,
  };
  const recordHash = canonicalRecordHash({ ...base, record_hash: undefined });
  return {
    ...base,
    record_hash: recordHash,
  };
}

async function appendAuditLogRecord(record) {
  if (!appendLogEnabled()) return null;
  const op = appendLogWriteChain.then(async () => {
    await initAppendLogChainState();
    const chained = buildChainedAppendLogRecord(record, appendLogLastRecordHash);
    const dir = APPEND_LOG_PATH.includes("/") ? APPEND_LOG_PATH.slice(0, APPEND_LOG_PATH.lastIndexOf("/")) : "";
    if (dir) await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.appendFile(APPEND_LOG_PATH, `${JSON.stringify(chained)}\n`, "utf8");
    appendLogLastRecordHash = String(chained.record_hash || "").trim();
    metrics.appendLogWritesTotal += 1;
    return chained;
  }).catch((err) => {
    metrics.appendLogWriteErrorsTotal += 1;
    throw err;
  });
  appendLogWriteChain = op.then(() => undefined, () => undefined);
  try {
    return await op;
  } catch {
    return null;
  }
}

async function readAuditLogLines(limit) {
  if (!appendLogEnabled()) return [];
  try {
    const raw = await fs.promises.readFile(APPEND_LOG_PATH, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const capped = Math.max(1, Math.min(APPEND_LOG_MAX_EXPORT_LINES, Math.round(Number(limit || 200))));
    return lines.slice(-capped);
  } catch {
    return [];
  }
}

function exportPrometheus() {
  const lines = [];
  const push = (s) => lines.push(s);
  push("# HELP forgeos_audit_signer_http_requests_total HTTP requests received.");
  push("# TYPE forgeos_audit_signer_http_requests_total counter");
  push(`forgeos_audit_signer_http_requests_total ${metrics.httpRequestsTotal}`);
  push("# HELP forgeos_audit_signer_auth_failures_total Auth failures.");
  push("# TYPE forgeos_audit_signer_auth_failures_total counter");
  push(`forgeos_audit_signer_auth_failures_total ${metrics.authFailuresTotal}`);
  push("# HELP forgeos_audit_signer_sign_requests_total Sign requests.");
  push("# TYPE forgeos_audit_signer_sign_requests_total counter");
  push(`forgeos_audit_signer_sign_requests_total ${metrics.signRequestsTotal}`);
  push("# HELP forgeos_audit_signer_sign_success_total Successful signatures.");
  push("# TYPE forgeos_audit_signer_sign_success_total counter");
  push(`forgeos_audit_signer_sign_success_total ${metrics.signSuccessTotal}`);
  push("# HELP forgeos_audit_signer_sign_errors_total Signature failures.");
  push("# TYPE forgeos_audit_signer_sign_errors_total counter");
  push(`forgeos_audit_signer_sign_errors_total ${metrics.signErrorsTotal}`);
  push("# HELP forgeos_audit_signer_command_exec_total External signer command executions.");
  push("# TYPE forgeos_audit_signer_command_exec_total counter");
  push(`forgeos_audit_signer_command_exec_total ${metrics.commandExecTotal}`);
  push("# HELP forgeos_audit_signer_command_exec_errors_total External signer command errors.");
  push("# TYPE forgeos_audit_signer_command_exec_errors_total counter");
  push(`forgeos_audit_signer_command_exec_errors_total ${metrics.commandExecErrorsTotal}`);
  push("# HELP forgeos_audit_signer_append_log_writes_total Append-only audit log writes.");
  push("# TYPE forgeos_audit_signer_append_log_writes_total counter");
  push(`forgeos_audit_signer_append_log_writes_total ${metrics.appendLogWritesTotal}`);
  push("# HELP forgeos_audit_signer_append_log_write_errors_total Append-only audit log write errors.");
  push("# TYPE forgeos_audit_signer_append_log_write_errors_total counter");
  push(`forgeos_audit_signer_append_log_write_errors_total ${metrics.appendLogWriteErrorsTotal}`);
  push("# HELP forgeos_audit_signer_mode Current signer mode (0 disabled, 1 local-key, 2 command).");
  push("# TYPE forgeos_audit_signer_mode gauge");
  push(`forgeos_audit_signer_mode ${signerMode === "command" ? 2 : signerMode === "local-key" ? 1 : 0}`);
  push("# HELP forgeos_audit_signer_uptime_seconds Service uptime.");
  push("# TYPE forgeos_audit_signer_uptime_seconds gauge");
  push(`forgeos_audit_signer_uptime_seconds ${((nowMs() - metrics.startedAtMs) / 1000).toFixed(3)}`);
  for (const [k, v] of metrics.httpResponsesByRouteStatus.entries()) {
    const [route, status] = String(k).split("|");
    push(`forgeos_audit_signer_http_responses_total{route="${esc(route)}",status="${esc(status)}"} ${v}`);
  }
  return `${lines.join("\n")}\n`;
}

function initSigner() {
  if (COMMAND) {
    signerMode = "command";
    if (!resolvedKeyId) resolvedKeyId = "external-command";
    return;
  }
  let pem = PRIVATE_KEY_PEM_ENV;
  if (!pem && PRIVATE_KEY_PATH) {
    pem = fs.readFileSync(PRIVATE_KEY_PATH, "utf8");
  }
  if (!pem) {
    signerMode = "disabled";
    return;
  }
  privateKeyObj = crypto.createPrivateKey(pem);
  const pub = crypto.createPublicKey(privateKeyObj);
  publicKeyPem = pub.export({ type: "spki", format: "pem" }).toString();
  publicKeyFingerprint = spkiFingerprint(publicKeyPem);
  if (!resolvedKeyId) resolvedKeyId = `pub:${publicKeyFingerprint.slice(0, 32)}`;
  localAlg = detectAlgForKey(privateKeyObj);
  signerMode = "local-key";
}

initSigner();

const server = http.createServer(async (req, res) => {
  const origin = resolveOrigin(req);
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const routeKey = `${req.method || "GET"} ${url.pathname}`;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Audit-Signer-Token",
    });
    res.end();
    recordHttp(routeKey, 204);
    return;
  }

  if (routeRequiresAuth(req, url.pathname)) {
    const token = getAuthToken(req);
    if (!token || !AUTH_TOKENS.includes(token)) {
      metrics.authFailuresTotal += 1;
      json(res, 401, { error: { message: "unauthorized" } }, origin);
      recordHttp(routeKey, 401);
      return;
    }
  }

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, {
      ok: true,
      service: "forgeos-audit-signer",
      signer: {
        mode: signerMode,
        keyId: resolvedKeyId || null,
        alg: localAlg || (COMMAND ? "external" : null),
        publicKeyFingerprint: publicKeyFingerprint || null,
      },
      appendLog: {
        enabled: appendLogEnabled(),
        path: APPEND_LOG_PATH || null,
        maxExportLines: APPEND_LOG_MAX_EXPORT_LINES,
      },
      auth: { enabled: authEnabled(), requireAuthForReads: REQUIRE_AUTH_FOR_READS },
      ts: nowMs(),
    }, origin);
    recordHttp(routeKey, 200);
    return;
  }

  if (req.method === "GET" && url.pathname === "/metrics") {
    text(res, 200, exportPrometheus(), origin);
    recordHttp(routeKey, 200);
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/public-key") {
    if (signerMode !== "local-key" || !publicKeyPem) {
      json(res, 404, { error: { message: "public_key_not_available" } }, origin);
      recordHttp(routeKey, 404);
      return;
    }
    json(res, 200, {
      ok: true,
      key: {
        keyId: resolvedKeyId,
        alg: localAlg,
        publicKeyPem,
        publicKeyFingerprint,
      },
      ts: nowMs(),
    }, origin);
    recordHttp(routeKey, 200);
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/audit-log") {
    if (!appendLogEnabled()) {
      json(res, 404, { error: { message: "append_log_not_configured" } }, origin);
      recordHttp(routeKey, 404);
      return;
    }
    const limit = Math.max(1, Math.min(APPEND_LOG_MAX_EXPORT_LINES, Number(url.searchParams.get("limit") || 200)));
    const format = String(url.searchParams.get("format") || "jsonl").trim().toLowerCase();
    const lines = await readAuditLogLines(limit);
    if (format === "json") {
      const records = lines.map((line) => {
        try { return JSON.parse(line); } catch { return { raw: line, parse_error: true }; }
      });
      json(res, 200, { ok: true, count: records.length, records, ts: nowMs() }, origin);
      recordHttp(routeKey, 200);
      return;
    }
    text(res, 200, lines.length > 0 ? `${lines.join("\n")}\n` : "", origin);
    recordHttp(routeKey, 200);
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/audit-sign") {
    metrics.signRequestsTotal += 1;
    let body;
    try {
      if (signerMode === "disabled") {
        json(res, 503, { error: { message: "audit_signer_not_configured" } }, origin);
        recordHttp(routeKey, 503);
        return;
      }
      body = await readJson(req);
      const signingPayload = normalizeSignRequest(body);
      const signature = await signDecisionAuditPayload(signingPayload);
      await appendAuditLogRecord(buildAppendLogRecord(signingPayload, signature));
      metrics.signSuccessTotal += 1;
      json(res, 200, {
        ok: true,
        signature,
        ts: nowMs(),
      }, origin);
      recordHttp(routeKey, 200);
      return;
    } catch (e) {
      metrics.signErrorsTotal += 1;
      json(res, 400, { error: { message: String(e?.message || "audit_sign_failed") } }, origin);
      recordHttp(routeKey, 400);
      return;
    }
  }

  json(res, 404, { error: { message: "not_found" } }, origin);
  recordHttp(routeKey, 404);
});

server.listen(PORT, HOST, () => {
  console.log(`[forgeos-audit-signer] listening on http://${HOST}:${PORT}`);
  console.log(`[forgeos-audit-signer] mode=${signerMode} key_id=${resolvedKeyId || "n/a"} auth=${authEnabled() ? "on" : "off"}`);
});

async function shutdown(signal) {
  try { server.close?.(); } catch {}
  if (signal) console.log(`[forgeos-audit-signer] shutdown ${signal}`);
}

process.on("SIGINT", () => { void shutdown("SIGINT"); });
process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
