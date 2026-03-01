import http from "node:http";
import os from "node:os";
import { NodeManager, resolveDefaultNodeBaseDir } from "./modules/nodeManager.mjs";
import { defaultRemoteRpcPools, normalizeNetworkProfile } from "./modules/networkProfiles.mjs";
import { selectRpcBackend } from "./modules/rpcBackendSelector.mjs";

const CONTROL_HOST = String(process.env.LOCAL_NODE_CONTROL_HOST || "127.0.0.1");
const CONTROL_PORT = Number(process.env.LOCAL_NODE_CONTROL_PORT || 19725);
const DEFAULT_PROFILE = normalizeNetworkProfile(process.env.LOCAL_NODE_DEFAULT_PROFILE || "mainnet");
const CONFIGURED_DATA_DIR = String(process.env.LOCAL_NODE_DATA_DIR || "").trim();
const DEFAULT_DATA_DIR = CONFIGURED_DATA_DIR || resolveDefaultNodeBaseDir({
  platform: process.platform,
  env: process.env,
  homeDir: os.homedir(),
});
const EVENTS_HEARTBEAT_MS = Math.max(5_000, Number(process.env.LOCAL_NODE_EVENTS_HEARTBEAT_MS || 15_000));
const STATUS_SNAPSHOT_CACHE_TTL_MS = Math.max(300, Number(process.env.LOCAL_NODE_STATUS_CACHE_TTL_MS || 1_250));
const REQUIRE_SYNC_FOR_SELECTION = String(process.env.LOCAL_NODE_REQUIRE_SYNC_FOR_SELECTION || "true")
  .trim()
  .toLowerCase() !== "false";

const manager = new NodeManager({
  binaryPath: process.env.LOCAL_NODE_KASPAD_BINARY || "",
  baseDataDir: DEFAULT_DATA_DIR,
  rpcHost: process.env.LOCAL_NODE_RPC_HOST || "127.0.0.1",
  rpcBaseUrl: process.env.LOCAL_NODE_RPC_BASE_URL || "",
  autoInstall: String(process.env.LOCAL_NODE_AUTO_INSTALL || "true").toLowerCase() !== "false",
});

/** @type {"mainnet"|"testnet-10"|"testnet-11"|"testnet-12"} */
let localNodeProfile = DEFAULT_PROFILE;
let localNodeEnabled = true;
let localNodeDataDirOverride = CONFIGURED_DATA_DIR;
const startedAtMs = Date.now();
const routeCounters = new Map();
const sseSubscribers = new Set();
const metricsState = {
  requestsTotal: 0,
  eventsEmittedTotal: 0,
  nodeStartTotal: 0,
  nodeStopTotal: 0,
  nodeRestartTotal: 0,
  backendLocalSelectedTotal: 0,
  backendRemoteSelectedTotal: 0,
  lastError: "",
  lastErrorAt: 0,
};
let statusSnapshotCache = { value: null, expiresAt: 0 };
let statusSnapshotInFlight = null;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify(body));
}

function markRequest(method, pathname) {
  metricsState.requestsTotal += 1;
  const key = `${String(method || "").toUpperCase()} ${pathname}`;
  routeCounters.set(key, Number(routeCounters.get(key) || 0) + 1);
}

function markBackendSelection(source) {
  if (source === "local") {
    metricsState.backendLocalSelectedTotal += 1;
  } else {
    metricsState.backendRemoteSelectedTotal += 1;
  }
}

function recordServiceError(error) {
  metricsState.lastError = error instanceof Error ? error.message : String(error);
  metricsState.lastErrorAt = Date.now();
}

function sseWrite(res, event, payload) {
  if (!res || res.writableEnded) return;
  const data = JSON.stringify(payload ?? {});
  res.write(`event: ${event}\n`);
  res.write(`data: ${data}\n\n`);
}

function broadcastEvent(event, payload) {
  metricsState.eventsEmittedTotal += 1;
  const envelope = {
    type: event,
    at: Date.now(),
    payload: payload ?? {},
  };
  for (const subscriber of sseSubscribers) {
    sseWrite(subscriber, event, envelope);
  }
}

function buildMetrics(statusSnapshot) {
  const status = statusSnapshot?.status ?? {};
  const sync = status?.sync ?? null;
  return {
    ok: true,
    uptimeSec: Math.max(0, Math.floor((Date.now() - startedAtMs) / 1_000)),
    control: {
      host: CONTROL_HOST,
      port: CONTROL_PORT,
      subscribers: sseSubscribers.size,
      requestsTotal: metricsState.requestsTotal,
      routeCounters: Object.fromEntries(routeCounters.entries()),
      eventsEmittedTotal: metricsState.eventsEmittedTotal,
      lastError: metricsState.lastError || null,
      lastErrorAt: metricsState.lastErrorAt || null,
    },
    node: {
      startsTotal: metricsState.nodeStartTotal,
      stopsTotal: metricsState.nodeStopTotal,
      restartsTotal: metricsState.nodeRestartTotal,
      backendLocalSelectedTotal: metricsState.backendLocalSelectedTotal,
      backendRemoteSelectedTotal: metricsState.backendRemoteSelectedTotal,
      running: Boolean(status?.running),
      rpcHealthy: Boolean(status?.rpcHealthy),
      synced: Boolean(sync?.synced),
      syncProgressPct: typeof sync?.progressPct === "number" ? sync.progressPct : null,
      networkProfile: status?.networkProfile ?? localNodeProfile,
    },
  };
}

function buildPrometheusMetrics(statusSnapshot) {
  const snapshot = buildMetrics(statusSnapshot);
  const routeLines = Object.entries(snapshot.control.routeCounters)
    .map(([route, count]) => `forgeos_local_node_requests_by_route_total{route="${route.replace(/"/g, '\\"')}"} ${count}`)
    .join("\n");
  const lines = [
    "# HELP forgeos_local_node_uptime_seconds Local node control service uptime in seconds.",
    "# TYPE forgeos_local_node_uptime_seconds gauge",
    `forgeos_local_node_uptime_seconds ${snapshot.uptimeSec}`,
    "# HELP forgeos_local_node_requests_total Total HTTP requests handled by local node control service.",
    "# TYPE forgeos_local_node_requests_total counter",
    `forgeos_local_node_requests_total ${snapshot.control.requestsTotal}`,
    "# HELP forgeos_local_node_events_subscribers Current SSE subscribers.",
    "# TYPE forgeos_local_node_events_subscribers gauge",
    `forgeos_local_node_events_subscribers ${snapshot.control.subscribers}`,
    "# HELP forgeos_local_node_events_emitted_total Total SSE events emitted.",
    "# TYPE forgeos_local_node_events_emitted_total counter",
    `forgeos_local_node_events_emitted_total ${snapshot.control.eventsEmittedTotal}`,
    "# HELP forgeos_local_node_starts_total Node start requests.",
    "# TYPE forgeos_local_node_starts_total counter",
    `forgeos_local_node_starts_total ${snapshot.node.startsTotal}`,
    "# HELP forgeos_local_node_stops_total Node stop requests.",
    "# TYPE forgeos_local_node_stops_total counter",
    `forgeos_local_node_stops_total ${snapshot.node.stopsTotal}`,
    "# HELP forgeos_local_node_restarts_total Node restart requests.",
    "# TYPE forgeos_local_node_restarts_total counter",
    `forgeos_local_node_restarts_total ${snapshot.node.restartsTotal}`,
    "# HELP forgeos_local_node_backend_local_selected_total Local backend selections.",
    "# TYPE forgeos_local_node_backend_local_selected_total counter",
    `forgeos_local_node_backend_local_selected_total ${snapshot.node.backendLocalSelectedTotal}`,
    "# HELP forgeos_local_node_backend_remote_selected_total Remote backend selections.",
    "# TYPE forgeos_local_node_backend_remote_selected_total counter",
    `forgeos_local_node_backend_remote_selected_total ${snapshot.node.backendRemoteSelectedTotal}`,
    "# HELP forgeos_local_node_running Whether local node process is running.",
    "# TYPE forgeos_local_node_running gauge",
    `forgeos_local_node_running ${snapshot.node.running ? 1 : 0}`,
    "# HELP forgeos_local_node_rpc_healthy Whether local node RPC probe is healthy.",
    "# TYPE forgeos_local_node_rpc_healthy gauge",
    `forgeos_local_node_rpc_healthy ${snapshot.node.rpcHealthy ? 1 : 0}`,
    "# HELP forgeos_local_node_synced Whether node is considered synced.",
    "# TYPE forgeos_local_node_synced gauge",
    `forgeos_local_node_synced ${snapshot.node.synced ? 1 : 0}`,
    "# HELP forgeos_local_node_sync_progress_pct Local node sync progress percentage.",
    "# TYPE forgeos_local_node_sync_progress_pct gauge",
    `forgeos_local_node_sync_progress_pct ${typeof snapshot.node.syncProgressPct === "number" ? snapshot.node.syncProgressPct : 0}`,
  ];
  if (routeLines) lines.push(routeLines);
  return `${lines.join("\n")}\n`;
}

function parseBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => { raw += String(chunk); });
    req.on("end", () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

function remotePoolForProfile(profile) {
  const defaults = defaultRemoteRpcPools();
  return defaults[profile] || defaults.mainnet;
}

async function composeStatusFresh() {
  await manager.refreshSync({ force: true });
  const status = manager.status();
  const activeDataRoot = localNodeDataDirOverride || DEFAULT_DATA_DIR;
  const backend = selectRpcBackend({
    targetNetwork: localNodeProfile,
    remotePool: remotePoolForProfile(localNodeProfile),
    localNodeEnabled,
    localNodeHealthy: status.rpcHealthy,
    localNodeSynced: Boolean(status?.sync?.synced),
    requireLocalSynced: REQUIRE_SYNC_FOR_SELECTION,
    localNodeProfile,
    localRpcBaseUrl: status.rpcBaseUrl || null,
  });
  markBackendSelection(backend.source);
  const snapshot = {
    ok: true,
    status: {
      ...status,
      networkProfile: localNodeProfile,
      dataDir: status.dataDir || null,
      dataDirBase: activeDataRoot,
      dataDirManagedDefault: DEFAULT_DATA_DIR,
      dataDirOverride: localNodeDataDirOverride || null,
    },
    backend,
  };
  statusSnapshotCache = {
    value: snapshot,
    expiresAt: Date.now() + STATUS_SNAPSHOT_CACHE_TTL_MS,
  };
  return snapshot;
}

async function composeStatus(options = {}) {
  const force = options.force === true;
  const now = Date.now();
  if (!force && statusSnapshotCache.value && statusSnapshotCache.expiresAt > now) {
    return statusSnapshotCache.value;
  }
  if (!force && statusSnapshotInFlight) {
    return statusSnapshotInFlight;
  }
  statusSnapshotInFlight = composeStatusFresh();
  try {
    return await statusSnapshotInFlight;
  } finally {
    statusSnapshotInFlight = null;
  }
}

function resolveDataDirForRequest(body) {
  const hasExplicitDataDir = body && Object.prototype.hasOwnProperty.call(body, "dataDir");
  if (hasExplicitDataDir) {
    if (typeof body?.dataDir === "string" && body.dataDir.trim()) {
      localNodeDataDirOverride = body.dataDir.trim();
    } else {
      // explicit null/empty => return to managed default path
      localNodeDataDirOverride = "";
    }
  }
  return localNodeDataDirOverride || DEFAULT_DATA_DIR;
}

async function handleNodeStart(body, res) {
  const profile = normalizeNetworkProfile(body?.networkProfile || localNodeProfile);
  const dataDir = resolveDataDirForRequest(body);
  localNodeProfile = profile;
  localNodeEnabled = true;
  metricsState.nodeStartTotal += 1;
  await manager.start({ networkProfile: profile, dataDir });
  const status = await composeStatus({ force: true });
  broadcastEvent("lifecycle", {
    action: "start",
    networkProfile: profile,
    dataDir,
  });
  broadcastEvent("status", status);
  json(res, 200, status);
}

async function handleNodeStop(_body, res) {
  metricsState.nodeStopTotal += 1;
  await manager.stop();
  const status = await composeStatus({ force: true });
  broadcastEvent("lifecycle", {
    action: "stop",
    networkProfile: localNodeProfile,
  });
  broadcastEvent("status", status);
  json(res, 200, status);
}

async function handleNodeRestart(body, res) {
  const profile = normalizeNetworkProfile(body?.networkProfile || localNodeProfile);
  const dataDir = resolveDataDirForRequest(body);
  localNodeProfile = profile;
  localNodeEnabled = true;
  metricsState.nodeRestartTotal += 1;
  await manager.restart({ networkProfile: profile, dataDir });
  const status = await composeStatus({ force: true });
  broadcastEvent("lifecycle", {
    action: "restart",
    networkProfile: profile,
    dataDir,
  });
  broadcastEvent("status", status);
  json(res, 200, status);
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) {
      json(res, 404, { ok: false, error: "Not found" });
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host || `${CONTROL_HOST}:${CONTROL_PORT}`}`);
    markRequest(req.method, url.pathname);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      const status = await composeStatus();
      json(res, 200, status);
      return;
    }

    if (req.method === "GET" && url.pathname === "/node/status") {
      const status = await composeStatus();
      json(res, 200, status);
      return;
    }

    if (req.method === "GET" && url.pathname === "/node/logs") {
      const lines = Number(url.searchParams.get("lines") || 80);
      const logs = await manager.getLogsTail(lines);
      json(res, 200, { ok: true, logs });
      return;
    }

    if (req.method === "GET" && url.pathname === "/metrics") {
      const status = await composeStatus();
      const wantsPrometheus = url.searchParams.get("format") === "prometheus"
        || String(req.headers.accept || "").includes("text/plain");
      if (wantsPrometheus) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.end(buildPrometheusMetrics(status));
        return;
      }
      json(res, 200, buildMetrics(status));
      return;
    }

    if (req.method === "GET" && url.pathname === "/events") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.write(": connected\n\n");
      sseSubscribers.add(res);
      sseWrite(res, "connected", {
        type: "connected",
        at: Date.now(),
        payload: {
          profile: localNodeProfile,
          dataDir: localNodeDataDirOverride || DEFAULT_DATA_DIR,
        },
      });
      const status = await composeStatus();
      sseWrite(res, "status", {
        type: "status",
        at: Date.now(),
        payload: status,
      });
      req.on("close", () => {
        sseSubscribers.delete(res);
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/node/start") {
      const body = await parseBody(req);
      await handleNodeStart(body, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/node/stop") {
      const body = await parseBody(req);
      await handleNodeStop(body, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/node/restart") {
      const body = await parseBody(req);
      await handleNodeRestart(body, res);
      return;
    }

    json(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    recordServiceError(error);
    broadcastEvent("error", {
      message: error instanceof Error ? error.message : String(error),
    });
    json(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

setInterval(async () => {
  if (sseSubscribers.size === 0) return;
  try {
    const status = await composeStatus({ force: true });
    broadcastEvent("status", status);
    broadcastEvent("heartbeat", { ok: true });
  } catch (error) {
    recordServiceError(error);
    broadcastEvent("error", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}, EVENTS_HEARTBEAT_MS);

server.listen(CONTROL_PORT, CONTROL_HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[local-node] control service listening on http://${CONTROL_HOST}:${CONTROL_PORT}`);
});
