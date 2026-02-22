import http from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";
import { createClient } from "redis";
import {
  newHistogram as metricsNewHistogram,
  observeHistogram as metricsObserveHistogram,
  inc as metricsInc,
  trackSchedulerLoad as metricsTrackSchedulerLoad,
  recordHttp as metricsRecordHttp,
} from "./modules/metrics.mjs";
import { createSchedulerAuth } from "./modules/auth.mjs";
import { createLeaderLockController } from "./modules/leaderLock.mjs";
import { createSchedulerRedisQueueController } from "./modules/redisQueue.mjs";
import { createSchedulerCallbacksController } from "./modules/callbacks.mjs";
import { createSchedulerRoutesController } from "./modules/routes.mjs";

const PORT = Number(process.env.PORT || 8790);
const HOST = process.env.HOST || "0.0.0.0";
const KAS_API_BASE = String(process.env.KAS_API_BASE || process.env.VITE_KAS_API_MAINNET || "https://api.kaspa.org").replace(/\/+$/, "");
const KAS_API_TIMEOUT_MS = Math.max(1000, Number(process.env.KAS_API_TIMEOUT_MS || 5000));
const MARKET_CACHE_TTL_MS = Math.max(250, Number(process.env.SCHEDULER_MARKET_CACHE_TTL_MS || 2000));
const BALANCE_CACHE_TTL_MS = Math.max(250, Number(process.env.SCHEDULER_BALANCE_CACHE_TTL_MS || 2500));
const TICK_MS = Math.max(250, Number(process.env.SCHEDULER_TICK_MS || 1000));
const CYCLE_CONCURRENCY = Math.max(1, Number(process.env.SCHEDULER_CYCLE_CONCURRENCY || 4));
const MAX_SCHEDULED_AGENTS = Math.max(1, Number(process.env.SCHEDULER_MAX_AGENTS || 5000));
const MAX_QUEUE_DEPTH = Math.max(1, Number(process.env.SCHEDULER_MAX_QUEUE || 10000));
const CALLBACK_TIMEOUT_MS = Math.max(500, Number(process.env.SCHEDULER_CALLBACK_TIMEOUT_MS || 4000));
const ALLOWED_ORIGINS = String(process.env.SCHEDULER_ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const AUTH_TOKENS = String(process.env.SCHEDULER_AUTH_TOKENS || process.env.SCHEDULER_AUTH_TOKEN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const REQUIRE_AUTH_FOR_READS = /^(1|true|yes)$/i.test(String(process.env.SCHEDULER_AUTH_READS || "false"));
const REDIS_URL = String(process.env.SCHEDULER_REDIS_URL || process.env.REDIS_URL || "").trim();
const REDIS_PREFIX = String(process.env.SCHEDULER_REDIS_PREFIX || "forgeos:scheduler").trim() || "forgeos:scheduler";
const REDIS_CONNECT_TIMEOUT_MS = Math.max(250, Number(process.env.SCHEDULER_REDIS_CONNECT_TIMEOUT_MS || 2000));
const REDIS_AUTHORITATIVE_QUEUE =
  /^(1|true|yes)$/i.test(String(process.env.SCHEDULER_REDIS_AUTHORITATIVE_QUEUE || "true"));
const INSTANCE_ID = String(process.env.SCHEDULER_INSTANCE_ID || crypto.randomUUID()).slice(0, 120);
const LEADER_LOCK_TTL_MS = Math.max(1000, Number(process.env.SCHEDULER_LEADER_LOCK_TTL_MS || 5000));
const LEADER_LOCK_RENEW_MS = Math.max(500, Number(process.env.SCHEDULER_LEADER_LOCK_RENEW_MS || Math.floor(LEADER_LOCK_TTL_MS / 2)));
const LEADER_LOCK_RENEW_JITTER_MS = Math.max(0, Number(process.env.SCHEDULER_LEADER_LOCK_RENEW_JITTER_MS || 250));
const LEADER_ACQUIRE_BACKOFF_MIN_MS = Math.max(50, Number(process.env.SCHEDULER_LEADER_ACQUIRE_BACKOFF_MIN_MS || 150));
const LEADER_ACQUIRE_BACKOFF_MAX_MS = Math.max(
  LEADER_ACQUIRE_BACKOFF_MIN_MS,
  Number(process.env.SCHEDULER_LEADER_ACQUIRE_BACKOFF_MAX_MS || 2000)
);
const JOB_LEASE_TTL_MS = Math.max(1000, Number(process.env.SCHEDULER_JOB_LEASE_TTL_MS || 15000));
const MAX_REDIS_DUE_CLAIMS_PER_TICK = Math.max(1, Number(process.env.SCHEDULER_MAX_DUE_CLAIMS_PER_TICK || CYCLE_CONCURRENCY * 2));
const REDIS_EXEC_LEASE_TTL_MS = Math.max(
  2000,
  Number(process.env.SCHEDULER_REDIS_EXEC_LEASE_TTL_MS || Math.max(30000, CALLBACK_TIMEOUT_MS + KAS_API_TIMEOUT_MS * 3))
);
const REDIS_EXEC_REQUEUE_BATCH = Math.max(1, Number(process.env.SCHEDULER_REDIS_EXEC_REQUEUE_BATCH || Math.max(10, CYCLE_CONCURRENCY * 4)));
const JWT_HS256_SECRET = String(process.env.SCHEDULER_JWT_HS256_SECRET || "").trim();
const JWT_ISSUER = String(process.env.SCHEDULER_JWT_ISSUER || "").trim();
const JWT_AUDIENCE = String(process.env.SCHEDULER_JWT_AUDIENCE || "").trim();
const JWKS_URL = String(process.env.SCHEDULER_JWKS_URL || process.env.SCHEDULER_OIDC_JWKS_URL || "").trim();
const JWKS_CACHE_TTL_MS = Math.max(1000, Number(process.env.SCHEDULER_JWKS_CACHE_TTL_MS || 300000));
const OIDC_ISSUER = String(process.env.SCHEDULER_OIDC_ISSUER || JWT_ISSUER || "").trim();
const OIDC_DISCOVERY_TTL_MS = Math.max(1000, Number(process.env.SCHEDULER_OIDC_DISCOVERY_TTL_MS || 300000));
const AUTH_HTTP_TIMEOUT_MS = Math.max(500, Number(process.env.SCHEDULER_AUTH_HTTP_TIMEOUT_MS || 5000));
const JWKS_ALLOWED_KIDS = String(process.env.SCHEDULER_JWKS_ALLOWED_KIDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const JWKS_REQUIRE_PINNED_KID = /^(1|true|yes)$/i.test(String(process.env.SCHEDULER_JWKS_REQUIRE_PINNED_KID || "false"));
const SERVICE_TOKENS_JSON = String(process.env.SCHEDULER_SERVICE_TOKENS_JSON || "").trim();
const QUOTA_WINDOW_MS = Math.max(1000, Number(process.env.SCHEDULER_QUOTA_WINDOW_MS || 60000));
const QUOTA_READ_MAX = Math.max(1, Number(process.env.SCHEDULER_QUOTA_READ_MAX || 600));
const QUOTA_WRITE_MAX = Math.max(1, Number(process.env.SCHEDULER_QUOTA_WRITE_MAX || 240));
const QUOTA_TICK_MAX = Math.max(1, Number(process.env.SCHEDULER_QUOTA_TICK_MAX || 60));
const CALLBACK_IDEMPOTENCY_TTL_MS = Math.max(1000, Number(process.env.SCHEDULER_CALLBACK_IDEMPOTENCY_TTL_MS || 24 * 60 * 60 * 1000));
const CALLBACK_IDEMPOTENCY_LEASE_MS = Math.max(
  CALLBACK_TIMEOUT_MS + 5000,
  Math.min(CALLBACK_IDEMPOTENCY_TTL_MS, CALLBACK_TIMEOUT_MS * 3)
);
const REDIS_RESET_EXEC_QUEUE_ON_BOOT = /^(1|true|yes)$/i.test(String(process.env.SCHEDULER_REDIS_RESET_EXEC_QUEUE_ON_BOOT || "false"));

const agents = new Map();
const cycleQueue = [];
let cycleInFlight = 0;
let isLeader = false;
let leaderLockToken = "";
let leaderLockValue = "";
let leaderFenceToken = 0;
let leaderLastRenewedAt = 0;
let leaderNextRenewAt = 0;
let leaderAcquireBackoffMs = 0;
let leaderAcquireBackoffUntil = 0;
let schedulerTickInFlight = false;
let redisQueuePumpActive = false;

const cache = {
  price: { value: null, ts: 0, inFlight: null },
  blockdag: { value: null, ts: 0, inFlight: null },
  balances: new Map(),
};

const metrics = {
  startedAtMs: Date.now(),
  httpRequestsTotal: 0,
  httpResponsesByRouteStatus: new Map(),
  ticksTotal: 0,
  dueAgentsTotal: 0,
  dispatchQueuedTotal: 0,
  dispatchStartedTotal: 0,
  dispatchCompletedTotal: 0,
  dispatchFailedTotal: 0,
  callbackSuccessTotal: 0,
  callbackErrorTotal: 0,
  callbackDedupeSkippedTotal: 0,
  queueFullTotal: 0,
  schedulerSaturationEventsTotal: 0,
  cacheHits: new Map(),
  cacheMisses: new Map(),
  cacheErrors: new Map(),
  upstreamLatencyMs: newHistogram([50, 100, 250, 500, 1000, 2500, 5000]),
  callbackLatencyMs: newHistogram([50, 100, 250, 500, 1000, 2500, 5000]),
  maxQueueDepthSeen: 0,
  maxInFlightSeen: 0,
  authFailuresTotal: 0,
  redisEnabled: false,
  redisConnected: false,
  redisOpsTotal: 0,
  redisErrorsTotal: 0,
  redisLastError: "",
  redisLoadedAgentsTotal: 0,
  redisAuthoritativeQueueEnabled: false,
  leaderAcquiredTotal: 0,
  leaderRenewFailedTotal: 0,
  leaderActiveMs: 0,
  leaderTransitionsTotal: 0,
  leaderFenceToken: 0,
  leaderAcquireBackoffTotal: 0,
  authSuccessTotal: 0,
  authJwtSuccessTotal: 0,
  authServiceTokenSuccessTotal: 0,
  authJwksSuccessTotal: 0,
  authScopeDeniedTotal: 0,
  quotaChecksTotal: 0,
  quotaExceededTotal: 0,
  redisExecQueueReadyDepth: 0,
  redisExecQueueProcessingDepth: 0,
  redisExecQueueInflightDepth: 0,
  redisExecClaimedTotal: 0,
  redisExecAckedTotal: 0,
  redisExecRequeuedExpiredTotal: 0,
  jwksFetchTotal: 0,
  jwksFetchErrorsTotal: 0,
  jwksCacheHitsTotal: 0,
  oidcDiscoveryFetchTotal: 0,
  oidcDiscoveryFetchErrorsTotal: 0,
  oidcDiscoveryCacheHitsTotal: 0,
  redisExecRecoveredOnBootTotal: 0,
  redisExecResetOnBootTotal: 0,
};
let schedulerSaturated = false;
let redisClient = null;
const quotaFallbackMemory = new Map();
const callbackIdempotencyMemory = new Map();
const jwksCache = {
  ts: 0,
  byKid: new Map(),
  inFlight: null,
};
const oidcDiscoveryCache = {
  ts: 0,
  value: null,
  inFlight: null,
};

const REDIS_KEYS = {
  agents: `${REDIS_PREFIX}:agents`,
  queue: `${REDIS_PREFIX}:cycle_queue`,
  queueProcessing: `${REDIS_PREFIX}:cycle_queue_processing`,
  queuePayloads: `${REDIS_PREFIX}:cycle_queue_payloads`,
  queueInflight: `${REDIS_PREFIX}:cycle_queue_inflight`,
  queueTaskOwners: `${REDIS_PREFIX}:cycle_queue_task_owners`,
  schedule: `${REDIS_PREFIX}:agent_schedule`,
  leaderLock: `${REDIS_PREFIX}:leader_lock`,
  leaderFence: `${REDIS_PREFIX}:leader_fence`,
  leasesPrefix: `${REDIS_PREFIX}:lease`,
  execLeasesPrefix: `${REDIS_PREFIX}:exec_lease`,
  execAgentTasksPrefix: `${REDIS_PREFIX}:exec_agent_tasks`,
  callbackDedupePrefix: `${REDIS_PREFIX}:callback_dedupe`,
  quotaPrefix: `${REDIS_PREFIX}:quota`,
};

const schedulerAuth = createSchedulerAuth({
  ALLOWED_ORIGINS,
  AUTH_TOKENS,
  REQUIRE_AUTH_FOR_READS,
  JWT_HS256_SECRET,
  JWT_ISSUER,
  JWT_AUDIENCE,
  JWKS_URL,
  JWKS_CACHE_TTL_MS,
  OIDC_ISSUER,
  OIDC_DISCOVERY_TTL_MS,
  AUTH_HTTP_TIMEOUT_MS,
  JWKS_ALLOWED_KIDS,
  JWKS_REQUIRE_PINNED_KID,
  SERVICE_TOKENS_JSON,
  QUOTA_WINDOW_MS,
  QUOTA_READ_MAX,
  QUOTA_WRITE_MAX,
  QUOTA_TICK_MAX,
  metrics,
  nowMs,
  json,
  redisOp,
  getRedisClient: () => redisClient,
  REDIS_KEYS,
  quotaFallbackMemory,
  jwksCache,
  oidcDiscoveryCache,
});

const leaderLockController = createLeaderLockController({
  metrics,
  redisOp,
  getRedisClient: () => redisClient,
  REDIS_KEYS,
  INSTANCE_ID,
  schedulerUsesRedisAuthoritativeQueue,
  nowMs,
  jitterMs,
  randomUUID: () => crypto.randomUUID(),
  LEADER_LOCK_TTL_MS,
  LEADER_LOCK_RENEW_MS,
  LEADER_LOCK_RENEW_JITTER_MS,
  LEADER_ACQUIRE_BACKOFF_MIN_MS,
  LEADER_ACQUIRE_BACKOFF_MAX_MS,
  getState: () => ({
    isLeader,
    leaderLockToken,
    leaderLockValue,
    leaderFenceToken,
    leaderLastRenewedAt,
    leaderNextRenewAt,
    leaderAcquireBackoffMs,
    leaderAcquireBackoffUntil,
  }),
  setState: (patch) => {
    if (Object.prototype.hasOwnProperty.call(patch, "isLeader")) isLeader = Boolean(patch.isLeader);
    if (Object.prototype.hasOwnProperty.call(patch, "leaderLockToken")) leaderLockToken = String(patch.leaderLockToken || "");
    if (Object.prototype.hasOwnProperty.call(patch, "leaderLockValue")) leaderLockValue = String(patch.leaderLockValue || "");
    if (Object.prototype.hasOwnProperty.call(patch, "leaderFenceToken")) leaderFenceToken = Math.max(0, Number(patch.leaderFenceToken || 0));
    if (Object.prototype.hasOwnProperty.call(patch, "leaderLastRenewedAt")) leaderLastRenewedAt = Math.max(0, Number(patch.leaderLastRenewedAt || 0));
    if (Object.prototype.hasOwnProperty.call(patch, "leaderNextRenewAt")) leaderNextRenewAt = Math.max(0, Number(patch.leaderNextRenewAt || 0));
    if (Object.prototype.hasOwnProperty.call(patch, "leaderAcquireBackoffMs")) leaderAcquireBackoffMs = Math.max(0, Number(patch.leaderAcquireBackoffMs || 0));
    if (Object.prototype.hasOwnProperty.call(patch, "leaderAcquireBackoffUntil")) leaderAcquireBackoffUntil = Math.max(0, Number(patch.leaderAcquireBackoffUntil || 0));
  },
});

const redisQueueController = createSchedulerRedisQueueController({
  metrics,
  redisOp,
  getRedisClient: () => redisClient,
  REDIS_KEYS,
  REDIS_AUTHORITATIVE_QUEUE,
  INSTANCE_ID,
  getLeaderFenceToken: () => leaderFenceToken,
  nowMs,
  randomUUID: () => crypto.randomUUID(),
  trackSchedulerLoad,
  cycleQueue,
  MAX_QUEUE_DEPTH,
  REDIS_EXEC_LEASE_TTL_MS,
  REDIS_EXEC_REQUEUE_BATCH,
});

const callbacksController = createSchedulerCallbacksController({
  metrics,
  observeHistogram,
  nowMs,
  CALLBACK_TIMEOUT_MS,
  redisOp,
  getRedisClient: () => redisClient,
  REDIS_KEYS,
  INSTANCE_ID,
  callbackIdempotencyMemory,
  CALLBACK_IDEMPOTENCY_TTL_MS,
  CALLBACK_IDEMPOTENCY_LEASE_MS,
});

function nowMs() {
  return Date.now();
}

function randInt(maxExclusive) {
  const n = Math.max(1, Number(maxExclusive || 1));
  return Math.floor(Math.random() * n);
}

function jitterMs(maxJitterMs) {
  const span = Math.max(0, Number(maxJitterMs || 0));
  return span > 0 ? randInt(span + 1) : 0;
}

function newHistogram(buckets) {
  return metricsNewHistogram(buckets);
}

function observeHistogram(hist, ms) {
  return metricsObserveHistogram(hist, ms);
}

function inc(map, key, by = 1) {
  return metricsInc(map, key, by);
}

function trackSchedulerLoad() {
  schedulerSaturated = metricsTrackSchedulerLoad({
    schedulerUsesRedisAuthoritativeQueue,
    metrics,
    cycleQueueLength: cycleQueue.length,
    cycleInFlight,
    maxQueueDepth: MAX_QUEUE_DEPTH,
    schedulerSaturated,
    cycleConcurrency: CYCLE_CONCURRENCY,
  });
}

function resolveOrigin(req) {
  return schedulerAuth.resolveOrigin(req);
}

function principalHasScope(principal, scope) {
  return schedulerAuth.principalHasScope(principal, scope);
}

function schedulerAuthEnabled() {
  return schedulerAuth.schedulerAuthEnabled();
}

async function requireAuth(req, res, origin, pathname) {
  return schedulerAuth.requireAuth(req, res, origin, pathname);
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

function json(res, status, body, origin = "*") {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-User-Id,Authorization,X-Scheduler-Token",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
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

function recordHttp(routeKey, statusCode, startedAtMs) {
  return metricsRecordHttp({
    metrics,
    routeKey,
    statusCode,
    startedAtMs,
    incFn: inc,
  });
}

function normalizeAddress(input) {
  const value = String(input || "").trim().toLowerCase();
  if (!value) return "";
  if (!value.startsWith("kaspa:") && !value.startsWith("kaspatest:")) return "";
  return value;
}

function agentKey(userId, agentId) {
  return `${String(userId || "anon").slice(0, 120)}:${String(agentId || "").slice(0, 120)}`;
}

function defaultAgentRecord(input, userId) {
  const id = String(input?.agentId || input?.id || "").trim();
  if (!id) throw new Error("agent_id_required");
  const address = normalizeAddress(input?.walletAddress);
  if (!address) throw new Error("wallet_address_required");
  const cycleMs = Math.max(1000, Number(input?.cycleIntervalMs || input?.cycleMs || 15000));
  return {
    userId: String(userId || "anon"),
    id,
    name: String(input?.name || id).slice(0, 120),
    walletAddress: address,
    status: String(input?.status || "RUNNING").toUpperCase() === "PAUSED" ? "PAUSED" : "RUNNING",
    cycleIntervalMs: cycleMs,
    callbackUrl: String(input?.callbackUrl || "").trim().slice(0, 500),
    strategyLabel: String(input?.strategyLabel || "Custom").slice(0, 120),
    createdAt: nowMs(),
    updatedAt: nowMs(),
    lastCycleAt: 0,
    nextRunAt: nowMs() + Math.min(cycleMs, 1000),
    lastDispatch: null,
    failureCount: 0,
    queuePending: false,
  };
}

function sanitizeAgentForStorage(agent) {
  if (!agent) return null;
  return {
    ...agent,
    queuePending: Boolean(agent.queuePending),
    lastDispatch: agent.lastDispatch ?? null,
  };
}

async function initRedis() {
  if (!REDIS_URL) return;
  metrics.redisEnabled = true;
  try {
    const client = createClient({ url: REDIS_URL, socket: { reconnectStrategy: (retries) => Math.min(1000 + retries * 250, 5000) } });
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
    metrics.redisAuthoritativeQueueEnabled = REDIS_AUTHORITATIVE_QUEUE;
    await loadAgentsFromRedis();
    if (REDIS_RESET_EXEC_QUEUE_ON_BOOT) {
      await redisOp("reset_exec_queue_state_on_boot", (r) =>
        r.del(
          REDIS_KEYS.queue,
          REDIS_KEYS.queueProcessing,
          REDIS_KEYS.queuePayloads,
          REDIS_KEYS.queueInflight,
          REDIS_KEYS.queueTaskOwners
        )
      );
      metrics.redisExecResetOnBootTotal += 1;
    } else {
      await rebuildRedisExecutionTaskIndexesOnBoot();
      await recoverRedisExecutionQueueOnBoot();
    }
    // Rebuild the authoritative schedule from agent records on startup.
    await redisOp("clear_schedule", (r) => r.del(REDIS_KEYS.schedule));
    for (const rec of agents.values()) {
      syncRedisScheduleForAgent(rec);
    }
    await refreshRedisExecutionQueueMetrics();
  } catch (e) {
    metrics.redisConnected = false;
    metrics.redisLastError = String(e?.message || e || "redis_init_failed").slice(0, 240);
    try {
      await redisClient?.disconnect?.();
    } catch {
      // Ignore disconnect failures during degraded startup.
    }
    redisClient = null;
    console.warn(`[forgeos-scheduler] redis init failed: ${metrics.redisLastError}`);
  }
}

async function loadAgentsFromRedis() {
  const raw = await redisOp("hGetAll_agents", (r) => r.hGetAll(REDIS_KEYS.agents));
  if (!raw || typeof raw !== "object") return;
  let loaded = 0;
  for (const [key, jsonValue] of Object.entries(raw)) {
    try {
      const parsed = JSON.parse(String(jsonValue || "{}"));
      if (!parsed || typeof parsed !== "object") continue;
      const userId = String(parsed.userId || key.split(":")[0] || "anon").slice(0, 120);
      const normalized = defaultAgentRecord(
        {
          ...parsed,
          agentId: parsed.id,
          walletAddress: parsed.walletAddress,
          status: parsed.status,
          cycleIntervalMs: parsed.cycleIntervalMs,
          callbackUrl: parsed.callbackUrl,
          strategyLabel: parsed.strategyLabel,
          name: parsed.name,
        },
        userId
      );
      const rehydrated = {
        ...normalized,
        createdAt: Number(parsed.createdAt || normalized.createdAt),
        updatedAt: Number(parsed.updatedAt || normalized.updatedAt),
        lastCycleAt: Number(parsed.lastCycleAt || 0),
        nextRunAt: Number(parsed.nextRunAt || nowMs() + 1000),
        failureCount: Math.max(0, Number(parsed.failureCount || 0)),
        queuePending: false,
        lastDispatch: parsed.lastDispatch ?? null,
      };
      agents.set(key, rehydrated);
      loaded += 1;
    } catch {
      // Ignore malformed agent rows.
    }
  }
  metrics.redisLoadedAgentsTotal = loaded;
}

function persistAgentToRedis(agent) {
  if (!redisClient || !agent?.id || !agent?.userId) return;
  const key = agentKey(agent.userId, agent.id);
  const payload = JSON.stringify(sanitizeAgentForStorage(agent));
  void redisOp("hSet_agent", (r) => r.hSet(REDIS_KEYS.agents, key, payload));
  syncRedisScheduleForAgent(agent);
}

function deleteAgentFromRedis(key) {
  if (!redisClient || !key) return;
  void redisOp("hDel_agent", (r) => r.hDel(REDIS_KEYS.agents, key));
  removeRedisScheduleForAgent(key);
}

function schedulerUsesRedisAuthoritativeQueue() {
  return redisQueueController.schedulerUsesRedisAuthoritativeQueue();
}

function leaseKeyForAgent(queueKey) {
  return redisQueueController.leaseKeyForAgent(queueKey);
}

function execLeaseKeyForTask(taskId) {
  return redisQueueController.execLeaseKeyForTask(taskId);
}

function execAgentTasksKey(queueKey) {
  return redisQueueController.execAgentTasksKey(queueKey);
}

function buildAgentCycleTask(queueKey) {
  return redisQueueController.buildAgentCycleTask(queueKey);
}

function parseExecutionTask(raw) {
  return redisQueueController.parseExecutionTask(raw);
}

async function refreshRedisExecutionQueueMetrics() {
  return redisQueueController.refreshRedisExecutionQueueMetrics();
}

async function rebuildRedisExecutionTaskIndexesOnBoot() {
  return redisQueueController.rebuildRedisExecutionTaskIndexesOnBoot();
}

async function enqueueRedisExecutionTask(task) {
  return redisQueueController.enqueueRedisExecutionTask(task);
}

async function claimRedisExecutionTask() {
  return redisQueueController.claimRedisExecutionTask();
}

async function ackRedisExecutionTask(taskId) {
  return redisQueueController.ackRedisExecutionTask(taskId);
}

async function requeueExpiredRedisExecutionTasks(limit = REDIS_EXEC_REQUEUE_BATCH) {
  return redisQueueController.requeueExpiredRedisExecutionTasks(limit);
}

async function recoverRedisExecutionQueueOnBoot() {
  return redisQueueController.recoverRedisExecutionQueueOnBoot();
}

function removeLocalQueuedTasksForAgent(queueKey) {
  return redisQueueController.removeLocalQueuedTasksForAgent(queueKey);
}

async function removeRedisQueuedTasksForAgent(queueKey) {
  return redisQueueController.removeRedisQueuedTasksForAgent(queueKey);
}

function agentScheduleScore(agent) {
  return Math.max(nowMs(), Number(agent?.nextRunAt || 0) || nowMs());
}

function syncRedisScheduleForAgent(agent) {
  if (!redisClient || !agent?.id || !agent?.userId) return;
  const key = agentKey(agent.userId, agent.id);
  if (String(agent?.status || "").toUpperCase() !== "RUNNING") {
    void redisOp("zRem_schedule_pause", (r) => r.zRem(REDIS_KEYS.schedule, key));
    return;
  }
  void redisOp("zAdd_schedule_upsert", (r) =>
    r.zAdd(REDIS_KEYS.schedule, [{ score: agentScheduleScore(agent), value: key }])
  );
}

function removeRedisScheduleForAgent(key) {
  if (!redisClient || !key) return;
  void redisOp("zRem_schedule_remove", (r) => r.zRem(REDIS_KEYS.schedule, key));
  void redisOp("del_agent_lease", (r) => r.del(leaseKeyForAgent(key)));
}

async function hydrateAgentFromRedis(queueKey) {
  if (!redisClient || !queueKey) return null;
  const payload = await redisOp("hGet_agent", (r) => r.hGet(REDIS_KEYS.agents, queueKey));
  if (!payload) return null;
  try {
    const parsed = JSON.parse(String(payload));
    const userId = String(parsed?.userId || queueKey.split(":")[0] || "anon").slice(0, 120);
    const normalized = defaultAgentRecord(
      {
        ...parsed,
        agentId: parsed?.id,
        walletAddress: parsed?.walletAddress,
        status: parsed?.status,
        cycleIntervalMs: parsed?.cycleIntervalMs,
        callbackUrl: parsed?.callbackUrl,
        strategyLabel: parsed?.strategyLabel,
        name: parsed?.name,
      },
      userId
    );
    const rec = {
      ...normalized,
      createdAt: Number(parsed?.createdAt || normalized.createdAt),
      updatedAt: Number(parsed?.updatedAt || normalized.updatedAt),
      lastCycleAt: Number(parsed?.lastCycleAt || 0),
      nextRunAt: Number(parsed?.nextRunAt || nowMs() + 1000),
      failureCount: Math.max(0, Number(parsed?.failureCount || 0)),
      queuePending: Boolean(parsed?.queuePending),
      lastDispatch: parsed?.lastDispatch ?? null,
    };
    agents.set(queueKey, rec);
    return rec;
  } catch {
    return null;
  }
}

async function claimDueAgentsFromRedis(limit = MAX_REDIS_DUE_CLAIMS_PER_TICK) {
  if (!schedulerUsesRedisAuthoritativeQueue()) return [];
  const now = nowMs();
  const claimedKeys = await redisOp("zRangeByScore_schedule_due", (r) =>
    r.zRangeByScore(REDIS_KEYS.schedule, 0, now, { LIMIT: { offset: 0, count: limit } })
  );
  if (!Array.isArray(claimedKeys) || !claimedKeys.length) return [];
  const out = [];
  for (const key of claimedKeys) {
    if (!key) continue;
    const leaseValue = JSON.stringify({
      instanceId: INSTANCE_ID,
      leaderFenceToken: Number(leaderFenceToken || 0),
      ts: nowMs(),
    });
    const leaseOk = await redisOp("set_job_lease", (r) =>
      r.set(leaseKeyForAgent(key), leaseValue, { NX: true, PX: JOB_LEASE_TTL_MS })
    );
    if (leaseOk !== "OK") continue;
    await redisOp("zAdd_schedule_claim_reservation", (r) =>
      r.zAdd(REDIS_KEYS.schedule, [{ score: now + JOB_LEASE_TTL_MS, value: key }])
    );
    out.push(String(key));
  }
  return out;
}

function scheduleNextLeaderRenewAt() {
  return leaderLockController.scheduleNextLeaderRenewAt();
}

function resetLeaderBackoff() {
  return leaderLockController.resetLeaderBackoff();
}

function bumpLeaderAcquireBackoff() {
  return leaderLockController.bumpLeaderAcquireBackoff();
}

async function acquireOrRenewLeaderLock() {
  return leaderLockController.acquireOrRenewLeaderLock();
}

async function releaseLeaderLock() {
  return leaderLockController.releaseLeaderLock();
}

async function fetchKaspaJson(path) {
  const started = nowMs();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), KAS_API_TIMEOUT_MS);
  let observed = false;
  try {
    const res = await fetch(`${KAS_API_BASE}${path}`, { signal: controller.signal, headers: { Accept: "application/json" } });
    const text = await res.text();
    observeHistogram(metrics.upstreamLatencyMs, nowMs() - started);
    observed = true;
    if (!res.ok) throw new Error(`upstream_${res.status}:${text.slice(0, 180)}`);
    return text ? JSON.parse(text) : {};
  } catch (e) {
    if (!observed) observeHistogram(metrics.upstreamLatencyMs, nowMs() - started);
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function withCachedEntry(key, state, ttlMs, loader) {
  const now = nowMs();
  if (state.value && now - Number(state.ts || 0) < ttlMs) {
    inc(metrics.cacheHits, key);
    return state.value;
  }
  if (state.inFlight) {
    inc(metrics.cacheHits, `${key}:inflight`);
    return state.inFlight;
  }
  inc(metrics.cacheMisses, key);
  state.inFlight = (async () => {
    try {
      const value = await loader();
      state.value = value;
      state.ts = nowMs();
      return value;
    } catch (e) {
      inc(metrics.cacheErrors, key);
      throw e;
    } finally {
      state.inFlight = null;
    }
  })();
  return state.inFlight;
}

function getBalanceCacheState(address) {
  const key = normalizeAddress(address);
  if (!key) throw new Error("wallet_address_required");
  let entry = cache.balances.get(key);
  if (!entry) {
    entry = { value: null, ts: 0, inFlight: null };
    cache.balances.set(key, entry);
  }
  if (cache.balances.size > 20_000) {
    for (const [addr, st] of cache.balances.entries()) {
      if (nowMs() - Number(st?.ts || 0) > BALANCE_CACHE_TTL_MS * 20) cache.balances.delete(addr);
      if (cache.balances.size <= 20_000) break;
    }
  }
  return entry;
}

async function getPriceSnapshot() {
  return withCachedEntry("price", cache.price, MARKET_CACHE_TTL_MS, async () => {
    const raw = await fetchKaspaJson("/info/price");
    return { priceUsd: Number(raw?.price || raw?.priceUsd || 0), raw };
  });
}

async function getBlockdagSnapshot() {
  return withCachedEntry("blockdag", cache.blockdag, MARKET_CACHE_TTL_MS, async () => {
    const raw = await fetchKaspaJson("/info/blockdag");
    const blockdag = raw?.blockdag || raw;
    const daaScore =
      Number(
        blockdag?.daaScore ??
        blockdag?.virtualDaaScore ??
        blockdag?.virtualDAAScore ??
        blockdag?.headerCount ??
        blockdag?.blockCount ??
        0
      ) || 0;
    return {
      daaScore,
      network: String(blockdag?.networkName || blockdag?.network || ""),
      raw: blockdag,
    };
  });
}

async function getBalanceSnapshot(address) {
  const normalized = normalizeAddress(address);
  const state = getBalanceCacheState(normalized);
  return withCachedEntry(`balance:${normalized.slice(0, 18)}`, state, BALANCE_CACHE_TTL_MS, async () => {
    const encoded = encodeURIComponent(normalized);
    const raw = await fetchKaspaJson(`/addresses/${encoded}/balance`);
    const sompi = Number(raw?.balance ?? raw?.sompi ?? 0);
    return { sompi, kas: sompi / 1e8, raw };
  });
}

async function getSharedMarketSnapshot(address) {
  const [price, blockdag, balance] = await Promise.all([
    getPriceSnapshot(),
    getBlockdagSnapshot(),
    getBalanceSnapshot(address),
  ]);
  return {
    ts: nowMs(),
    address: normalizeAddress(address),
    priceUsd: Number(price?.priceUsd || 0),
    dag: { daaScore: Number(blockdag?.daaScore || 0), network: blockdag?.network || "" },
    walletKas: Number(balance?.kas || 0),
  };
}

async function enqueueCycleTask(task) {
  const parsedTask = parseExecutionTask(task);
  if (!parsedTask) throw new Error("invalid_execution_task");

  if (schedulerUsesRedisAuthoritativeQueue()) {
    await enqueueRedisExecutionTask(parsedTask);
    drainCycleQueue();
    return;
  }

  if (cycleQueue.length >= MAX_QUEUE_DEPTH) {
    metrics.queueFullTotal += 1;
    trackSchedulerLoad();
    throw new Error("scheduler_queue_full");
  }
  cycleQueue.push(parsedTask);
  metrics.dispatchQueuedTotal += 1;
  trackSchedulerLoad();
  drainCycleQueue();
}

async function processCycleTask(task) {
  const parsedTask = parseExecutionTask(task);
  if (!parsedTask) return;
  if (parsedTask.kind !== "agent_cycle") return;
  const key = parsedTask.queueKey;
  try {
    let agent = agents.get(key);
    if (!agent && schedulerUsesRedisAuthoritativeQueue()) {
      agent = await hydrateAgentFromRedis(key);
    }
    if (!agent) return;
    await dispatchAgentCycle(agents.get(key) || agent, {
      leaderFenceToken: parsedTask.leaderFenceToken,
      schedulerInstanceId: parsedTask.instanceId || INSTANCE_ID,
      queueTaskId: parsedTask.id,
    });
  } finally {
    if (schedulerUsesRedisAuthoritativeQueue() && key) {
      await redisOp("del_job_lease_finalize", (r) => r.del(leaseKeyForAgent(key)));
    }
  }
}

async function pumpRedisExecutionQueue() {
  if (redisQueuePumpActive || !schedulerUsesRedisAuthoritativeQueue()) return;
  redisQueuePumpActive = true;
  try {
    await requeueExpiredRedisExecutionTasks();
    while (cycleInFlight < CYCLE_CONCURRENCY) {
      const task = await claimRedisExecutionTask();
      if (!task) break;
      const taskId = String(task.id || "");
      cycleInFlight += 1;
      trackSchedulerLoad();
      void (async () => {
        try {
          await processCycleTask(task);
        } catch {
          // dispatchAgentCycle captures dispatch failures; keep worker pump resilient to unexpected exceptions.
        } finally {
          try {
            await ackRedisExecutionTask(taskId);
          } catch {
            // Keep local worker loop moving even if ack fails; expired in-flight tasks will be requeued.
          }
          cycleInFlight -= 1;
          trackSchedulerLoad();
          drainCycleQueue();
        }
      })();
    }
  } finally {
    redisQueuePumpActive = false;
  }
}

function drainCycleQueue() {
  if (schedulerUsesRedisAuthoritativeQueue()) {
    void pumpRedisExecutionQueue();
    return;
  }
  while (cycleInFlight < CYCLE_CONCURRENCY && cycleQueue.length) {
    const task = cycleQueue.shift();
    cycleInFlight += 1;
    trackSchedulerLoad();
    void processCycleTask(task)
      .catch(() => {})
      .finally(() => {
        cycleInFlight -= 1;
        trackSchedulerLoad();
        drainCycleQueue();
      });
  }
}

async function postCallback(url, payload) {
  return callbacksController.postCallback(url, payload);
}

function callbackDedupeDoneKey(idempotencyKey) {
  return callbacksController.callbackDedupeDoneKey(idempotencyKey);
}

function callbackDedupeLeaseKey(idempotencyKey) {
  return callbacksController.callbackDedupeLeaseKey(idempotencyKey);
}

async function beginCallbackIdempotency(idempotencyKey) {
  return callbacksController.beginCallbackIdempotency(idempotencyKey);
}

async function completeCallbackIdempotency(idempotencyKey, leaseToken) {
  return callbacksController.completeCallbackIdempotency(idempotencyKey, leaseToken);
}

async function releaseCallbackIdempotencyLease(idempotencyKey, leaseToken) {
  return callbacksController.releaseCallbackIdempotencyLease(idempotencyKey, leaseToken);
}

async function dispatchAgentCycle(agent, meta = {}) {
  if (!agent || agent.status !== "RUNNING") return;
  metrics.dispatchStartedTotal += 1;
  agent.queuePending = false;
  persistAgentToRedis(agent);
  const started = nowMs();
  try {
    const snapshot = await getSharedMarketSnapshot(agent.walletAddress);
    const fenceToken = Math.max(0, Number(meta?.leaderFenceToken || leaderFenceToken || 0));
    const queueTaskId = String(meta?.queueTaskId || "").trim();
    const agentDispatchKey = `${String(agent.userId || "anon")}:${String(agent.id || "")}`;
    const callbackIdempotencyKey = `forgeos.scheduler:${agentDispatchKey}:${fenceToken}:${queueTaskId || Math.floor(started / 1000)}`;
    const callbackHeaders = {
      "X-ForgeOS-Scheduler-Instance": String(meta?.schedulerInstanceId || INSTANCE_ID),
      "X-ForgeOS-Leader-Fence-Token": String(fenceToken),
      "X-ForgeOS-Idempotency-Key": callbackIdempotencyKey,
      ...(queueTaskId ? { "X-ForgeOS-Queue-Task-Id": queueTaskId } : {}),
      "X-ForgeOS-Agent-Key": agentDispatchKey,
    };
    const payload = {
      event: "forgeos.scheduler.cycle",
      ts: nowMs(),
      scheduler: {
        instanceId: String(meta?.schedulerInstanceId || INSTANCE_ID),
        leaderFenceToken: fenceToken,
        queueTaskId: queueTaskId || null,
        callbackIdempotencyKey,
        callbackHeaders,
      },
      agent: {
        id: agent.id,
        userId: agent.userId,
        name: agent.name,
        strategyLabel: agent.strategyLabel,
        cycleIntervalMs: agent.cycleIntervalMs,
      },
      market: snapshot,
    };
    let callbackDeduped = false;
    if (agent.callbackUrl) {
      const callbackLease = await beginCallbackIdempotency(callbackIdempotencyKey);
      if (callbackLease.shouldSend) {
        try {
          await postCallback(agent.callbackUrl, payload);
          await completeCallbackIdempotency(callbackIdempotencyKey, callbackLease.leaseToken);
        } catch (e) {
          await releaseCallbackIdempotencyLease(callbackIdempotencyKey, callbackLease.leaseToken);
          throw e;
        }
      } else {
        callbackDeduped = true;
        metrics.callbackDedupeSkippedTotal += 1;
      }
    }
    agent.lastCycleAt = nowMs();
    agent.nextRunAt = agent.lastCycleAt + agent.cycleIntervalMs;
    agent.updatedAt = nowMs();
    agent.failureCount = 0;
    agent.lastDispatch = {
      ok: true,
      ts: nowMs(),
      durationMs: nowMs() - started,
      callbackUrl: agent.callbackUrl || null,
      callbackIdempotencyKey,
      callbackDeduped,
      snapshotDaa: Number(snapshot?.dag?.daaScore || 0),
      snapshotPriceUsd: Number(snapshot?.priceUsd || 0),
    };
    metrics.dispatchCompletedTotal += 1;
    persistAgentToRedis(agent);
  } catch (e) {
    agent.failureCount = Number(agent.failureCount || 0) + 1;
    agent.updatedAt = nowMs();
    agent.nextRunAt = nowMs() + Math.min(agent.cycleIntervalMs, 5000);
    agent.lastDispatch = {
      ok: false,
      ts: nowMs(),
      durationMs: nowMs() - started,
      error: String(e?.message || "dispatch_failed").slice(0, 240),
    };
    metrics.dispatchFailedTotal += 1;
    persistAgentToRedis(agent);
  }
}

async function schedulerTick() {
  if (schedulerTickInFlight) return;
  schedulerTickInFlight = true;
  metrics.ticksTotal += 1;
  try {
    if (schedulerUsesRedisAuthoritativeQueue()) {
      const leaderOk = await acquireOrRenewLeaderLock();
      if (leaderOk) {
        leaderLastRenewedAt = nowMs();
        const claimedKeys = await claimDueAgentsFromRedis();
        metrics.dueAgentsTotal += claimedKeys.length;
        for (const key of claimedKeys) {
          let agent = agents.get(key);
          if (!agent) agent = await hydrateAgentFromRedis(key);
          if (!agent) {
            removeRedisScheduleForAgent(key);
            continue;
          }
          if (agent.status !== "RUNNING") {
            removeRedisScheduleForAgent(key);
            continue;
          }
          agent.queuePending = true;
          persistAgentToRedis(agent);
          try {
            await enqueueCycleTask(buildAgentCycleTask(key));
          } catch {
            agent.queuePending = false;
            agent.lastDispatch = {
              ok: false,
              ts: nowMs(),
              error: "scheduler_queue_full",
            };
            agent.failureCount = Number(agent.failureCount || 0) + 1;
            agent.nextRunAt = nowMs() + 3000;
            persistAgentToRedis(agent);
            await redisOp("del_job_lease_queue_full", (r) => r.del(leaseKeyForAgent(key)));
          }
        }
      }
      drainCycleQueue();
      return;
    }

    const now = nowMs();
    let dueCount = 0;
    for (const agent of agents.values()) {
      if (!agent || agent.status !== "RUNNING") continue;
      if (agent.queuePending) continue;
      if (Number(agent.nextRunAt || 0) > now) continue;
      dueCount += 1;
      agent.queuePending = true;
      persistAgentToRedis(agent);
      const key = agentKey(agent.userId, agent.id);
      try {
        await enqueueCycleTask(buildAgentCycleTask(key));
      } catch {
        agent.queuePending = false;
        agent.lastDispatch = {
          ok: false,
          ts: nowMs(),
          error: "scheduler_queue_full",
        };
        agent.failureCount = Number(agent.failureCount || 0) + 1;
        agent.nextRunAt = nowMs() + 3000;
        persistAgentToRedis(agent);
      }
    }
    metrics.dueAgentsTotal += dueCount;
  } finally {
    schedulerTickInFlight = false;
  }
}

function exportPrometheus() {
  const lines = [];
  const push = (line) => lines.push(line);
  push("# HELP forgeos_scheduler_http_requests_total HTTP requests received.");
  push("# TYPE forgeos_scheduler_http_requests_total counter");
  push(`forgeos_scheduler_http_requests_total ${metrics.httpRequestsTotal}`);

  push("# HELP forgeos_scheduler_http_responses_total HTTP responses by route and status.");
  push("# TYPE forgeos_scheduler_http_responses_total counter");
  for (const [key, value] of metrics.httpResponsesByRouteStatus.entries()) {
    const [route, status] = String(key).split("|");
    push(`forgeos_scheduler_http_responses_total{route="${esc(route)}",status="${esc(status)}"} ${value}`);
  }

  push("# HELP forgeos_scheduler_agents_registered Current registered agents.");
  push("# TYPE forgeos_scheduler_agents_registered gauge");
  push(`forgeos_scheduler_agents_registered ${agents.size}`);

  push("# HELP forgeos_scheduler_cycle_queue_depth Current scheduler cycle queue depth.");
  push("# TYPE forgeos_scheduler_cycle_queue_depth gauge");
  push(`forgeos_scheduler_cycle_queue_depth ${cycleQueue.length}`);

  push("# HELP forgeos_scheduler_cycle_in_flight Current scheduler in-flight cycles.");
  push("# TYPE forgeos_scheduler_cycle_in_flight gauge");
  push(`forgeos_scheduler_cycle_in_flight ${cycleInFlight}`);

  push("# HELP forgeos_scheduler_ticks_total Scheduler ticks executed.");
  push("# TYPE forgeos_scheduler_ticks_total counter");
  push(`forgeos_scheduler_ticks_total ${metrics.ticksTotal}`);

  push("# HELP forgeos_scheduler_due_agents_total Due agents scanned across ticks.");
  push("# TYPE forgeos_scheduler_due_agents_total counter");
  push(`forgeos_scheduler_due_agents_total ${metrics.dueAgentsTotal}`);

  push("# HELP forgeos_scheduler_dispatch_queued_total Cycles queued for dispatch.");
  push("# TYPE forgeos_scheduler_dispatch_queued_total counter");
  push(`forgeos_scheduler_dispatch_queued_total ${metrics.dispatchQueuedTotal}`);

  push("# HELP forgeos_scheduler_dispatch_started_total Cycle dispatches started.");
  push("# TYPE forgeos_scheduler_dispatch_started_total counter");
  push(`forgeos_scheduler_dispatch_started_total ${metrics.dispatchStartedTotal}`);

  push("# HELP forgeos_scheduler_dispatch_completed_total Cycle dispatches completed.");
  push("# TYPE forgeos_scheduler_dispatch_completed_total counter");
  push(`forgeos_scheduler_dispatch_completed_total ${metrics.dispatchCompletedTotal}`);

  push("# HELP forgeos_scheduler_dispatch_failed_total Cycle dispatches failed.");
  push("# TYPE forgeos_scheduler_dispatch_failed_total counter");
  push(`forgeos_scheduler_dispatch_failed_total ${metrics.dispatchFailedTotal}`);

  push("# HELP forgeos_scheduler_callback_success_total Callback POST successes.");
  push("# TYPE forgeos_scheduler_callback_success_total counter");
  push(`forgeos_scheduler_callback_success_total ${metrics.callbackSuccessTotal}`);

  push("# HELP forgeos_scheduler_callback_error_total Callback POST failures.");
  push("# TYPE forgeos_scheduler_callback_error_total counter");
  push(`forgeos_scheduler_callback_error_total ${metrics.callbackErrorTotal}`);

  push("# HELP forgeos_scheduler_callback_dedupe_skipped_total Callback sends skipped due to idempotency dedupe.");
  push("# TYPE forgeos_scheduler_callback_dedupe_skipped_total counter");
  push(`forgeos_scheduler_callback_dedupe_skipped_total ${metrics.callbackDedupeSkippedTotal}`);

  push("# HELP forgeos_scheduler_queue_full_total Queue full events.");
  push("# TYPE forgeos_scheduler_queue_full_total counter");
  push(`forgeos_scheduler_queue_full_total ${metrics.queueFullTotal}`);

  push("# HELP forgeos_scheduler_saturation_events_total Scheduler saturation threshold crossings.");
  push("# TYPE forgeos_scheduler_saturation_events_total counter");
  push(`forgeos_scheduler_saturation_events_total ${metrics.schedulerSaturationEventsTotal}`);

  push("# HELP forgeos_scheduler_auth_failures_total Scheduler auth failures.");
  push("# TYPE forgeos_scheduler_auth_failures_total counter");
  push(`forgeos_scheduler_auth_failures_total ${metrics.authFailuresTotal}`);

  push("# HELP forgeos_scheduler_redis_enabled Redis configured for scheduler.");
  push("# TYPE forgeos_scheduler_redis_enabled gauge");
  push(`forgeos_scheduler_redis_enabled ${metrics.redisEnabled ? 1 : 0}`);

  push("# HELP forgeos_scheduler_redis_connected Redis connection status.");
  push("# TYPE forgeos_scheduler_redis_connected gauge");
  push(`forgeos_scheduler_redis_connected ${metrics.redisConnected ? 1 : 0}`);

  push("# HELP forgeos_scheduler_redis_ops_total Redis operations attempted.");
  push("# TYPE forgeos_scheduler_redis_ops_total counter");
  push(`forgeos_scheduler_redis_ops_total ${metrics.redisOpsTotal}`);

  push("# HELP forgeos_scheduler_redis_errors_total Redis operation errors.");
  push("# TYPE forgeos_scheduler_redis_errors_total counter");
  push(`forgeos_scheduler_redis_errors_total ${metrics.redisErrorsTotal}`);

  push("# HELP forgeos_scheduler_redis_authoritative_queue_enabled Redis authoritative queue mode enabled.");
  push("# TYPE forgeos_scheduler_redis_authoritative_queue_enabled gauge");
  push(`forgeos_scheduler_redis_authoritative_queue_enabled ${metrics.redisAuthoritativeQueueEnabled ? 1 : 0}`);

  push("# HELP forgeos_scheduler_redis_exec_queue_ready_depth Redis execution queue ready depth.");
  push("# TYPE forgeos_scheduler_redis_exec_queue_ready_depth gauge");
  push(`forgeos_scheduler_redis_exec_queue_ready_depth ${Number(metrics.redisExecQueueReadyDepth || 0)}`);

  push("# HELP forgeos_scheduler_redis_exec_queue_processing_depth Redis execution queue processing depth.");
  push("# TYPE forgeos_scheduler_redis_exec_queue_processing_depth gauge");
  push(`forgeos_scheduler_redis_exec_queue_processing_depth ${Number(metrics.redisExecQueueProcessingDepth || 0)}`);

  push("# HELP forgeos_scheduler_redis_exec_queue_inflight_depth Redis execution queue inflight zset depth.");
  push("# TYPE forgeos_scheduler_redis_exec_queue_inflight_depth gauge");
  push(`forgeos_scheduler_redis_exec_queue_inflight_depth ${Number(metrics.redisExecQueueInflightDepth || 0)}`);

  push("# HELP forgeos_scheduler_redis_exec_claimed_total Redis execution tasks claimed.");
  push("# TYPE forgeos_scheduler_redis_exec_claimed_total counter");
  push(`forgeos_scheduler_redis_exec_claimed_total ${metrics.redisExecClaimedTotal}`);

  push("# HELP forgeos_scheduler_redis_exec_acked_total Redis execution tasks acknowledged.");
  push("# TYPE forgeos_scheduler_redis_exec_acked_total counter");
  push(`forgeos_scheduler_redis_exec_acked_total ${metrics.redisExecAckedTotal}`);

  push("# HELP forgeos_scheduler_redis_exec_requeued_expired_total Redis execution tasks requeued after expired lease.");
  push("# TYPE forgeos_scheduler_redis_exec_requeued_expired_total counter");
  push(`forgeos_scheduler_redis_exec_requeued_expired_total ${metrics.redisExecRequeuedExpiredTotal}`);

  push("# HELP forgeos_scheduler_redis_exec_recovered_on_boot_total Redis execution tasks recovered/requeued during scheduler startup.");
  push("# TYPE forgeos_scheduler_redis_exec_recovered_on_boot_total counter");
  push(`forgeos_scheduler_redis_exec_recovered_on_boot_total ${metrics.redisExecRecoveredOnBootTotal}`);

  push("# HELP forgeos_scheduler_redis_exec_reset_on_boot_total Redis execution queue resets on boot (debug/legacy mode).");
  push("# TYPE forgeos_scheduler_redis_exec_reset_on_boot_total counter");
  push(`forgeos_scheduler_redis_exec_reset_on_boot_total ${metrics.redisExecResetOnBootTotal}`);

  push("# HELP forgeos_scheduler_leader_active Leader lock status for this instance.");
  push("# TYPE forgeos_scheduler_leader_active gauge");
  push(`forgeos_scheduler_leader_active ${isLeader ? 1 : 0}`);

  push("# HELP forgeos_scheduler_leader_acquired_total Leader lock acquisitions.");
  push("# TYPE forgeos_scheduler_leader_acquired_total counter");
  push(`forgeos_scheduler_leader_acquired_total ${metrics.leaderAcquiredTotal}`);

  push("# HELP forgeos_scheduler_leader_renew_failed_total Leader renew failures.");
  push("# TYPE forgeos_scheduler_leader_renew_failed_total counter");
  push(`forgeos_scheduler_leader_renew_failed_total ${metrics.leaderRenewFailedTotal}`);

  push("# HELP forgeos_scheduler_leader_fence_token Current leader fencing token for this instance (0 when not leader).");
  push("# TYPE forgeos_scheduler_leader_fence_token gauge");
  push(`forgeos_scheduler_leader_fence_token ${Number(metrics.leaderFenceToken || 0)}`);

  push("# HELP forgeos_scheduler_leader_acquire_backoff_total Leader acquire backoff events.");
  push("# TYPE forgeos_scheduler_leader_acquire_backoff_total counter");
  push(`forgeos_scheduler_leader_acquire_backoff_total ${metrics.leaderAcquireBackoffTotal}`);

  push("# HELP forgeos_scheduler_auth_success_total Authenticated requests accepted.");
  push("# TYPE forgeos_scheduler_auth_success_total counter");
  push(`forgeos_scheduler_auth_success_total ${metrics.authSuccessTotal}`);

  push("# HELP forgeos_scheduler_auth_jwks_success_total JWT auth successes validated via JWKS.");
  push("# TYPE forgeos_scheduler_auth_jwks_success_total counter");
  push(`forgeos_scheduler_auth_jwks_success_total ${metrics.authJwksSuccessTotal}`);

  push("# HELP forgeos_scheduler_auth_scope_denied_total Authenticated requests denied by scope.");
  push("# TYPE forgeos_scheduler_auth_scope_denied_total counter");
  push(`forgeos_scheduler_auth_scope_denied_total ${metrics.authScopeDeniedTotal}`);

  push("# HELP forgeos_scheduler_quota_checks_total Quota checks executed.");
  push("# TYPE forgeos_scheduler_quota_checks_total counter");
  push(`forgeos_scheduler_quota_checks_total ${metrics.quotaChecksTotal}`);

  push("# HELP forgeos_scheduler_quota_exceeded_total Quota exceed events.");
  push("# TYPE forgeos_scheduler_quota_exceeded_total counter");
  push(`forgeos_scheduler_quota_exceeded_total ${metrics.quotaExceededTotal}`);

  push("# HELP forgeos_scheduler_jwks_fetch_total JWKS fetch attempts.");
  push("# TYPE forgeos_scheduler_jwks_fetch_total counter");
  push(`forgeos_scheduler_jwks_fetch_total ${metrics.jwksFetchTotal}`);

  push("# HELP forgeos_scheduler_jwks_fetch_errors_total JWKS fetch failures.");
  push("# TYPE forgeos_scheduler_jwks_fetch_errors_total counter");
  push(`forgeos_scheduler_jwks_fetch_errors_total ${metrics.jwksFetchErrorsTotal}`);

  push("# HELP forgeos_scheduler_jwks_cache_hits_total JWKS cache hits.");
  push("# TYPE forgeos_scheduler_jwks_cache_hits_total counter");
  push(`forgeos_scheduler_jwks_cache_hits_total ${metrics.jwksCacheHitsTotal}`);

  push("# HELP forgeos_scheduler_oidc_discovery_fetch_total OIDC discovery fetch attempts.");
  push("# TYPE forgeos_scheduler_oidc_discovery_fetch_total counter");
  push(`forgeos_scheduler_oidc_discovery_fetch_total ${metrics.oidcDiscoveryFetchTotal}`);

  push("# HELP forgeos_scheduler_oidc_discovery_fetch_errors_total OIDC discovery fetch failures.");
  push("# TYPE forgeos_scheduler_oidc_discovery_fetch_errors_total counter");
  push(`forgeos_scheduler_oidc_discovery_fetch_errors_total ${metrics.oidcDiscoveryFetchErrorsTotal}`);

  push("# HELP forgeos_scheduler_oidc_discovery_cache_hits_total OIDC discovery cache hits.");
  push("# TYPE forgeos_scheduler_oidc_discovery_cache_hits_total counter");
  push(`forgeos_scheduler_oidc_discovery_cache_hits_total ${metrics.oidcDiscoveryCacheHitsTotal}`);

  for (const [kind, value] of metrics.cacheHits.entries()) {
    push(`forgeos_scheduler_cache_hits_total{kind="${esc(kind)}"} ${value}`);
  }
  for (const [kind, value] of metrics.cacheMisses.entries()) {
    push(`forgeos_scheduler_cache_misses_total{kind="${esc(kind)}"} ${value}`);
  }
  for (const [kind, value] of metrics.cacheErrors.entries()) {
    push(`forgeos_scheduler_cache_errors_total{kind="${esc(kind)}"} ${value}`);
  }

  appendHistogram(lines, "forgeos_scheduler_upstream_latency_ms", "Kaspa upstream fetch latency (ms).", metrics.upstreamLatencyMs);
  appendHistogram(lines, "forgeos_scheduler_callback_latency_ms", "Callback dispatch latency (ms).", metrics.callbackLatencyMs);

  push("# HELP forgeos_scheduler_uptime_seconds Scheduler uptime seconds.");
  push("# TYPE forgeos_scheduler_uptime_seconds gauge");
  push(`forgeos_scheduler_uptime_seconds ${((nowMs() - metrics.startedAtMs) / 1000).toFixed(3)}`);

  return `${lines.join("\n")}\n`;
}

function appendHistogram(lines, name, help, hist) {
  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} histogram`);
  for (const bucket of hist.buckets) {
    lines.push(`${name}_bucket{le="${bucket}"} ${Number(hist.counts.get(bucket) || 0)}`);
  }
  lines.push(`${name}_bucket{le="+Inf"} ${hist.count}`);
  lines.push(`${name}_sum ${Number(hist.sum.toFixed(3))}`);
  lines.push(`${name}_count ${hist.count}`);
}

function esc(v) {
  return String(v ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

const routesController = createSchedulerRoutesController({
  resolveOrigin,
  requireAuth,
  recordHttp,
  json,
  readJson,
  principalHasScope,
  exportPrometheus,
  schedulerUsesRedisAuthoritativeQueue,
  schedulerAuthEnabled,
  normalizeAddress,
  defaultAgentRecord,
  agentKey,
  persistAgentToRedis,
  deleteAgentFromRedis,
  removeLocalQueuedTasksForAgent,
  removeRedisQueuedTasksForAgent,
  getSharedMarketSnapshot,
  schedulerTick,
  nowMs,
  getRuntime: () => ({
    metrics,
    agents,
    cycleQueue,
    cycleInFlight,
    cache,
    schedulerSaturated,
    isLeader,
    leaderLastRenewedAt,
    leaderNextRenewAt,
    leaderFenceToken,
    leaderAcquireBackoffUntil,
  }),
  getAuthConfig: () => ({
    REQUIRE_AUTH_FOR_READS,
    JWT_HS256_SECRET,
    JWKS_URL,
    OIDC_ISSUER,
    JWKS_ALLOWED_KIDS_LENGTH: JWKS_ALLOWED_KIDS.length,
    JWKS_REQUIRE_PINNED_KID,
    QUOTA_WINDOW_MS,
    QUOTA_READ_MAX,
    QUOTA_WRITE_MAX,
    QUOTA_TICK_MAX,
  }),
  getConfig: () => ({
    KAS_API_BASE,
    TICK_MS,
    MAX_QUEUE_DEPTH,
    CYCLE_CONCURRENCY,
    INSTANCE_ID,
    LEADER_LOCK_TTL_MS,
    REDIS_PREFIX,
    MAX_SCHEDULED_AGENTS,
  }),
  getServiceTokenRegistrySize: () => schedulerAuth.serviceTokenRegistrySize(),
});

function listAgents(principal = null) {
  return routesController.listAgents(principal);
}

const server = http.createServer((req, res) => {
  void routesController.handleRequest(req, res);
});

const tickInterval = setInterval(() => {
  void schedulerTick();
}, TICK_MS);
tickInterval.unref?.();

const leaderRenewInterval = setInterval(() => {
  if (!schedulerUsesRedisAuthoritativeQueue()) return;
  void acquireOrRenewLeaderLock();
}, LEADER_LOCK_RENEW_MS);
leaderRenewInterval.unref?.();

await initRedis();

server.listen(PORT, HOST, () => {
  console.log(`[forgeos-scheduler] listening on http://${HOST}:${PORT}`);
  console.log(
    `[forgeos-scheduler] kas_api=${KAS_API_BASE} tick_ms=${TICK_MS} concurrency=${CYCLE_CONCURRENCY} auth=${schedulerAuthEnabled() ? "on" : "off"} redis=${metrics.redisConnected ? "connected" : metrics.redisEnabled ? "configured" : "off"} queue_mode=${schedulerUsesRedisAuthoritativeQueue() ? "redis-authoritative" : "local"} instance=${INSTANCE_ID}`
  );
});

async function shutdown(signal) {
  try {
    clearInterval(tickInterval);
    clearInterval(leaderRenewInterval);
  } catch {}
  try {
    await releaseLeaderLock();
  } catch {}
  try {
    await redisClient?.quit?.();
  } catch {}
  try {
    server.close?.();
  } catch {}
  if (signal) console.log(`[forgeos-scheduler] shutdown ${signal}`);
}

process.on("SIGINT", () => { void shutdown("SIGINT"); });
process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
