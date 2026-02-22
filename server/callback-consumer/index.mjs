import http from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";
import { createClient } from "redis";

const PORT = Number(process.env.PORT || 8796);
const HOST = String(process.env.HOST || "0.0.0.0");
const ALLOWED_ORIGINS = String(process.env.CALLBACK_CONSUMER_ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const AUTH_TOKENS = String(process.env.CALLBACK_CONSUMER_AUTH_TOKENS || process.env.CALLBACK_CONSUMER_AUTH_TOKEN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const REQUIRE_AUTH_FOR_READS = /^(1|true|yes)$/i.test(String(process.env.CALLBACK_CONSUMER_AUTH_READS || "false"));
const REDIS_URL = String(process.env.CALLBACK_CONSUMER_REDIS_URL || process.env.REDIS_URL || "").trim();
const REDIS_PREFIX = String(process.env.CALLBACK_CONSUMER_REDIS_PREFIX || "forgeos:callback-consumer").trim() || "forgeos:callback-consumer";
const REDIS_CONNECT_TIMEOUT_MS = Math.max(250, Number(process.env.CALLBACK_CONSUMER_REDIS_CONNECT_TIMEOUT_MS || 2000));
const IDEMPOTENCY_TTL_MS = Math.max(1000, Number(process.env.CALLBACK_CONSUMER_IDEMPOTENCY_TTL_MS || 24 * 60 * 60 * 1000));
const MAX_EVENTS = Math.max(10, Number(process.env.CALLBACK_CONSUMER_MAX_EVENTS || 500));
const MAX_RECEIPTS = Math.max(10, Number(process.env.CALLBACK_CONSUMER_MAX_RECEIPTS || 2000));

let redisClient = null;
const recentEvents = [];
const recentReceipts = new Map();
const idempotencyMemory = new Map();
const fenceMemory = new Map();

const metrics = {
  startedAtMs: Date.now(),
  httpRequestsTotal: 0,
  httpResponsesByRouteStatus: new Map(),
  authFailuresTotal: 0,
  cycleAcceptedTotal: 0,
  cycleDuplicateTotal: 0,
  cycleStaleFenceTotal: 0,
  cycleErrorsTotal: 0,
  receiptAcceptedTotal: 0,
  receiptDuplicateTotal: 0,
  redisEnabled: false,
  redisConnected: false,
  redisOpsTotal: 0,
  redisErrorsTotal: 0,
  redisLastError: "",
};

const REDIS_KEYS = {
  idempotencyPrefix: `${REDIS_PREFIX}:idem`,
  fencePrefix: `${REDIS_PREFIX}:fence`,
  receiptPrefix: `${REDIS_PREFIX}:receipt`,
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
  return String(req.headers["x-callback-consumer-token"] || "").trim();
}

function json(res, status, body, origin = "*") {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Callback-Consumer-Token",
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
      raw += chunk;
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

async function redisOp(name, fn) {
  if (!redisClient) return null;
  try {
    metrics.redisOpsTotal += 1;
    return await fn(redisClient);
  } catch (e) {
    metrics.redisErrorsTotal += 1;
    metrics.redisLastError = String(e?.message || e || name).slice(0, 240);
    return null;
  }
}

function pruneIdempotencyMemory(now = nowMs()) {
  if (idempotencyMemory.size <= 50_000) return;
  for (const [k, v] of idempotencyMemory.entries()) {
    if (!v || now >= Number(v.expAt || 0)) idempotencyMemory.delete(k);
    if (idempotencyMemory.size <= 50_000) break;
  }
}

async function checkIdempotency(idempotencyKey) {
  const key = String(idempotencyKey || "").trim();
  if (!key) return { ok: false, reason: "idempotency_key_required" };
  if (redisClient) {
    const redisKey = `${REDIS_KEYS.idempotencyPrefix}:${key}`;
    const ok = await redisOp("idempotency_set_nx", (r) => r.set(redisKey, "1", { NX: true, PX: IDEMPOTENCY_TTL_MS }));
    if (ok == null) return { ok: true, duplicate: false, mode: "redis_fail_open" };
    if (ok !== "OK") return { ok: true, duplicate: true, mode: "redis" };
    return { ok: true, duplicate: false, mode: "redis" };
  }
  const now = nowMs();
  const prev = idempotencyMemory.get(key);
  if (prev && now < Number(prev.expAt || 0)) return { ok: true, duplicate: true, mode: "memory" };
  idempotencyMemory.set(key, { expAt: now + IDEMPOTENCY_TTL_MS });
  pruneIdempotencyMemory(now);
  return { ok: true, duplicate: false, mode: "memory" };
}

async function getFenceToken(agentKey) {
  const key = String(agentKey || "").trim();
  if (!key) return 0;
  if (redisClient) {
    const value = await redisOp("fence_get", (r) => r.get(`${REDIS_KEYS.fencePrefix}:${key}`));
    if (value == null) return 0;
    return Math.max(0, Number(value || 0));
  }
  return Math.max(0, Number(fenceMemory.get(key) || 0));
}

async function setFenceToken(agentKey, token) {
  const key = String(agentKey || "").trim();
  const next = Math.max(0, Number(token || 0));
  if (!key) return;
  if (redisClient) {
    await redisOp("fence_set", (r) => r.set(`${REDIS_KEYS.fencePrefix}:${key}`, String(next)));
    return;
  }
  fenceMemory.set(key, next);
}

function normalizeCycleRequest(req, body) {
  const scheduler = body?.scheduler && typeof body.scheduler === "object" ? body.scheduler : {};
  const agent = body?.agent && typeof body.agent === "object" ? body.agent : {};
  const headerIdem = String(req.headers["x-forgeos-idempotency-key"] || "").trim();
  const headerFence = String(req.headers["x-forgeos-leader-fence-token"] || "").trim();
  const headerAgentKey = String(req.headers["x-forgeos-agent-key"] || "").trim();
  const idempotencyKey = headerIdem || String(scheduler?.callbackIdempotencyKey || "").trim();
  const agentKey = headerAgentKey || [String(agent?.userId || "").trim(), String(agent?.id || "").trim()].filter(Boolean).join(":");
  const fenceToken = Math.max(0, Number(headerFence || scheduler?.leaderFenceToken || 0));
  if (!idempotencyKey) throw new Error("idempotency_key_required");
  if (!agentKey) throw new Error("agent_key_required");
  if (!Number.isFinite(fenceToken)) throw new Error("invalid_fence_token");
  return { idempotencyKey, agentKey, fenceToken, scheduler, agent, event: body };
}

function normalizeReceiptRequest(req, body) {
  const txid = String(body?.txid || body?.transactionId || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/i.test(txid)) throw new Error("invalid_txid");
  const idempotencyKey =
    String(req.headers["x-forgeos-idempotency-key"] || "").trim() ||
    String(body?.idempotencyKey || `receipt:${txid}`).trim();
  const agentKey =
    String(body?.agentKey || "").trim() ||
    [String(body?.userId || "").trim(), String(body?.agentId || "").trim()].filter(Boolean).join(":");
  const receipt = {
    txid,
    agentKey: agentKey || null,
    userId: body?.userId ? String(body.userId).slice(0, 120) : null,
    agentId: body?.agentId ? String(body.agentId).slice(0, 120) : null,
    walletAddress: body?.walletAddress ? String(body.walletAddress).slice(0, 120) : null,
    network: body?.network ? String(body.network).slice(0, 40) : null,
    status: String(body?.status || "confirmed").slice(0, 40),
    confirmations: Math.max(0, Number(body?.confirmations || 0)),
    feeKas: Number.isFinite(Number(body?.feeKas)) ? Number(Number(body.feeKas).toFixed(8)) : null,
    feeSompi: Number.isFinite(Number(body?.feeSompi)) ? Math.max(0, Math.round(Number(body.feeSompi))) : null,
    broadcastTs: Number.isFinite(Number(body?.broadcastTs)) ? Math.round(Number(body.broadcastTs)) : null,
    confirmTs: Number.isFinite(Number(body?.confirmTs)) ? Math.round(Number(body.confirmTs)) : null,
    confirmTsSource: body?.confirmTsSource ? String(body.confirmTsSource).slice(0, 40) : null,
    slippageKas: Number.isFinite(Number(body?.slippageKas)) ? Number(Number(body.slippageKas).toFixed(8)) : null,
    priceAtBroadcastUsd: Number.isFinite(Number(body?.priceAtBroadcastUsd)) ? Number(Number(body.priceAtBroadcastUsd).toFixed(8)) : null,
    priceAtConfirmUsd: Number.isFinite(Number(body?.priceAtConfirmUsd)) ? Number(Number(body.priceAtConfirmUsd).toFixed(8)) : null,
    source: body?.source ? String(body.source).slice(0, 120) : "external",
    raw: body?.raw && typeof body.raw === "object" ? body.raw : undefined,
    updatedAt: nowMs(),
  };
  return { idempotencyKey, receipt };
}

function pushRecentEvent(entry) {
  recentEvents.unshift(entry);
  if (recentEvents.length > MAX_EVENTS) recentEvents.length = MAX_EVENTS;
}

function upsertReceipt(entry) {
  recentReceipts.set(entry.txid, entry);
  if (recentReceipts.size <= MAX_RECEIPTS) return;
  const oldestKey = recentReceipts.keys().next().value;
  if (oldestKey) recentReceipts.delete(oldestKey);
}

async function persistReceiptToRedis(receipt) {
  if (!redisClient) return;
  await redisOp("receipt_set", (r) =>
    r.set(`${REDIS_KEYS.receiptPrefix}:${receipt.txid}`, JSON.stringify(receipt), { PX: IDEMPOTENCY_TTL_MS * 7 })
  );
}

async function readReceiptFromRedis(txid) {
  if (!redisClient) return null;
  const raw = await redisOp("receipt_get", (r) => r.get(`${REDIS_KEYS.receiptPrefix}:${txid}`));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function exportPrometheus() {
  const lines = [];
  const push = (s) => lines.push(s);
  push("# HELP forgeos_callback_consumer_http_requests_total HTTP requests received.");
  push("# TYPE forgeos_callback_consumer_http_requests_total counter");
  push(`forgeos_callback_consumer_http_requests_total ${metrics.httpRequestsTotal}`);
  push("# HELP forgeos_callback_consumer_auth_failures_total Auth failures.");
  push("# TYPE forgeos_callback_consumer_auth_failures_total counter");
  push(`forgeos_callback_consumer_auth_failures_total ${metrics.authFailuresTotal}`);
  push("# HELP forgeos_callback_consumer_cycle_accepted_total Accepted scheduler cycle callbacks.");
  push("# TYPE forgeos_callback_consumer_cycle_accepted_total counter");
  push(`forgeos_callback_consumer_cycle_accepted_total ${metrics.cycleAcceptedTotal}`);
  push("# HELP forgeos_callback_consumer_cycle_duplicate_total Duplicate scheduler callbacks skipped.");
  push("# TYPE forgeos_callback_consumer_cycle_duplicate_total counter");
  push(`forgeos_callback_consumer_cycle_duplicate_total ${metrics.cycleDuplicateTotal}`);
  push("# HELP forgeos_callback_consumer_cycle_stale_fence_total Stale scheduler callbacks rejected by fence token.");
  push("# TYPE forgeos_callback_consumer_cycle_stale_fence_total counter");
  push(`forgeos_callback_consumer_cycle_stale_fence_total ${metrics.cycleStaleFenceTotal}`);
  push("# HELP forgeos_callback_consumer_receipt_accepted_total Execution receipts accepted.");
  push("# TYPE forgeos_callback_consumer_receipt_accepted_total counter");
  push(`forgeos_callback_consumer_receipt_accepted_total ${metrics.receiptAcceptedTotal}`);
  push("# HELP forgeos_callback_consumer_receipt_duplicate_total Execution receipts skipped by idempotency.");
  push("# TYPE forgeos_callback_consumer_receipt_duplicate_total counter");
  push(`forgeos_callback_consumer_receipt_duplicate_total ${metrics.receiptDuplicateTotal}`);
  push("# HELP forgeos_callback_consumer_recent_events_count In-memory stored callback events.");
  push("# TYPE forgeos_callback_consumer_recent_events_count gauge");
  push(`forgeos_callback_consumer_recent_events_count ${recentEvents.length}`);
  push("# HELP forgeos_callback_consumer_recent_receipts_count In-memory stored receipt records.");
  push("# TYPE forgeos_callback_consumer_recent_receipts_count gauge");
  push(`forgeos_callback_consumer_recent_receipts_count ${recentReceipts.size}`);
  push("# HELP forgeos_callback_consumer_redis_enabled Redis configured.");
  push("# TYPE forgeos_callback_consumer_redis_enabled gauge");
  push(`forgeos_callback_consumer_redis_enabled ${metrics.redisEnabled ? 1 : 0}`);
  push("# HELP forgeos_callback_consumer_redis_connected Redis connected.");
  push("# TYPE forgeos_callback_consumer_redis_connected gauge");
  push(`forgeos_callback_consumer_redis_connected ${metrics.redisConnected ? 1 : 0}`);
  push("# HELP forgeos_callback_consumer_redis_ops_total Redis operations attempted.");
  push("# TYPE forgeos_callback_consumer_redis_ops_total counter");
  push(`forgeos_callback_consumer_redis_ops_total ${metrics.redisOpsTotal}`);
  push("# HELP forgeos_callback_consumer_redis_errors_total Redis operation errors.");
  push("# TYPE forgeos_callback_consumer_redis_errors_total counter");
  push(`forgeos_callback_consumer_redis_errors_total ${metrics.redisErrorsTotal}`);
  push("# HELP forgeos_callback_consumer_uptime_seconds Service uptime.");
  push("# TYPE forgeos_callback_consumer_uptime_seconds gauge");
  push(`forgeos_callback_consumer_uptime_seconds ${((nowMs() - metrics.startedAtMs) / 1000).toFixed(3)}`);

  for (const [k, v] of metrics.httpResponsesByRouteStatus.entries()) {
    const [route, status] = String(k).split("|");
    push(`forgeos_callback_consumer_http_responses_total{route="${esc(route)}",status="${esc(status)}"} ${v}`);
  }
  return `${lines.join("\n")}\n`;
}

function esc(v) {
  return String(v ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

async function initRedis() {
  if (!REDIS_URL) return;
  metrics.redisEnabled = true;
  try {
    const client = createClient({
      url: REDIS_URL,
      socket: { reconnectStrategy: (retries) => Math.min(1000 + retries * 250, 5000) },
    });
    client.on("error", (e) => {
      metrics.redisConnected = false;
      metrics.redisLastError = String(e?.message || e || "redis_error").slice(0, 240);
    });
    client.on("ready", () => {
      metrics.redisConnected = true;
    });
    client.on("end", () => {
      metrics.redisConnected = false;
    });
    await Promise.race([
      client.connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`redis_connect_timeout_${REDIS_CONNECT_TIMEOUT_MS}ms`)), REDIS_CONNECT_TIMEOUT_MS)
      ),
    ]);
    redisClient = client;
    metrics.redisConnected = true;
  } catch (e) {
    metrics.redisConnected = false;
    metrics.redisLastError = String(e?.message || e || "redis_init_failed").slice(0, 240);
    try {
      await redisClient?.disconnect?.();
    } catch {
      // ignore
    }
    redisClient = null;
  }
}

const server = http.createServer(async (req, res) => {
  const origin = resolveOrigin(req);
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const routeKey = `${req.method || "GET"} ${url.pathname}`;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Callback-Consumer-Token",
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
      service: "forgeos-callback-consumer",
      auth: { enabled: authEnabled(), requireAuthForReads: REQUIRE_AUTH_FOR_READS },
      redis: { enabled: metrics.redisEnabled, connected: metrics.redisConnected, lastError: metrics.redisLastError || null },
      stores: { events: recentEvents.length, receipts: recentReceipts.size },
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

  if (req.method === "GET" && url.pathname === "/v1/events") {
    json(res, 200, { events: recentEvents.slice(0, MAX_EVENTS), ts: nowMs() }, origin);
    recordHttp(routeKey, 200);
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/execution-receipts") {
    const txid = String(url.searchParams.get("txid") || "").trim().toLowerCase();
    if (txid) {
      const local = recentReceipts.get(txid);
      const receipt = local || (await readReceiptFromRedis(txid));
      if (!receipt) {
        json(res, 404, { error: { message: "receipt_not_found", txid } }, origin);
        recordHttp(routeKey, 404);
        return;
      }
      json(res, 200, { receipt, ts: nowMs() }, origin);
      recordHttp(routeKey, 200);
      return;
    }
    json(res, 200, { receipts: Array.from(recentReceipts.values()), ts: nowMs() }, origin);
    recordHttp(routeKey, 200);
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/scheduler/cycle") {
    let body;
    try {
      body = await readJson(req);
      const normalized = normalizeCycleRequest(req, body);
      const idem = await checkIdempotency(normalized.idempotencyKey);
      if (!idem.ok) throw new Error(String(idem.reason || "idempotency_failed"));
      if (idem.duplicate) {
        metrics.cycleDuplicateTotal += 1;
        json(res, 200, { ok: true, duplicate: true, reason: "idempotency_duplicate", ts: nowMs() }, origin);
        recordHttp(routeKey, 200);
        return;
      }
      const currentFence = await getFenceToken(normalized.agentKey);
      if (normalized.fenceToken < currentFence) {
        metrics.cycleStaleFenceTotal += 1;
        json(res, 409, {
          error: { message: "stale_fence_token", currentFence, receivedFence: normalized.fenceToken, agentKey: normalized.agentKey },
        }, origin);
        recordHttp(routeKey, 409);
        return;
      }
      if (normalized.fenceToken > currentFence) {
        await setFenceToken(normalized.agentKey, normalized.fenceToken);
      }
      pushRecentEvent({
        id: crypto.randomUUID(),
        type: "scheduler_cycle",
        ts: nowMs(),
        idempotencyKey: normalized.idempotencyKey,
        agentKey: normalized.agentKey,
        fenceToken: normalized.fenceToken,
        schedulerInstanceId: String(normalized.scheduler?.instanceId || "").slice(0, 120) || null,
        queueTaskId: normalized.scheduler?.queueTaskId ? String(normalized.scheduler.queueTaskId).slice(0, 120) : null,
        agent: {
          id: normalized.agent?.id ? String(normalized.agent.id).slice(0, 120) : null,
          userId: normalized.agent?.userId ? String(normalized.agent.userId).slice(0, 120) : null,
          name: normalized.agent?.name ? String(normalized.agent.name).slice(0, 120) : null,
          strategyLabel: normalized.agent?.strategyLabel ? String(normalized.agent.strategyLabel).slice(0, 120) : null,
        },
      });
      metrics.cycleAcceptedTotal += 1;
      json(res, 200, { ok: true, accepted: true, duplicate: false, ts: nowMs() }, origin);
      recordHttp(routeKey, 200);
    } catch (e) {
      metrics.cycleErrorsTotal += 1;
      json(res, 400, { error: { message: String(e?.message || "invalid_callback") } }, origin);
      recordHttp(routeKey, 400);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/execution-receipts") {
    let body;
    try {
      body = await readJson(req);
      const { idempotencyKey, receipt } = normalizeReceiptRequest(req, body);
      const idem = await checkIdempotency(idempotencyKey);
      if (!idem.ok) throw new Error(String(idem.reason || "idempotency_failed"));
      if (idem.duplicate) {
        metrics.receiptDuplicateTotal += 1;
        json(res, 200, { ok: true, duplicate: true, txid: receipt.txid, ts: nowMs() }, origin);
        recordHttp(routeKey, 200);
        return;
      }
      upsertReceipt(receipt);
      await persistReceiptToRedis(receipt);
      metrics.receiptAcceptedTotal += 1;
      json(res, 200, { ok: true, accepted: true, txid: receipt.txid, receipt, ts: nowMs() }, origin);
      recordHttp(routeKey, 200);
    } catch (e) {
      json(res, 400, { error: { message: String(e?.message || "invalid_receipt") } }, origin);
      recordHttp(routeKey, 400);
    }
    return;
  }

  json(res, 404, { error: { message: "not_found" } }, origin);
  recordHttp(routeKey, 404);
});

await initRedis();

server.listen(PORT, HOST, () => {
  console.log(`[forgeos-callback-consumer] listening on http://${HOST}:${PORT}`);
  console.log(
    `[forgeos-callback-consumer] auth=${authEnabled() ? "on" : "off"} redis=${metrics.redisEnabled ? (metrics.redisConnected ? "connected" : "degraded") : "off"}`
  );
});

