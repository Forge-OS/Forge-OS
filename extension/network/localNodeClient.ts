const ENV = (import.meta as any)?.env ?? {};
const DEFAULT_LOCAL_NODE_CONTROL_URL = "http://127.0.0.1:19725";
const LOCAL_NODE_REQUEST_TIMEOUT_MS = 1_500;
const LOCAL_NODE_OPERATION_TIMEOUT_MS = 15_000;
const LOCAL_NODE_STOP_TIMEOUT_MS = 8_000;

export interface LocalNodeSyncSnapshot {
  synced: boolean;
  progressPct: number | null;
  blockCount: number | null;
  headerCount: number | null;
  source: string;
  updatedAt: number;
}

export interface LocalNodeStatus {
  running: boolean;
  pid: number | null;
  networkProfile: string;
  dataDir: string | null;
  dataDirBase?: string | null;
  dataDirManagedDefault?: string | null;
  dataDirOverride?: string | null;
  rpcBaseUrl: string | null;
  rpcHealthy: boolean;
  connectionState?: "stopped" | "connecting" | "healthy" | "syncing" | "degraded";
  restartCount: number;
  backoffMs: number;
  lastStartAt: number | null;
  lastExitAt: number | null;
  lastExitCode: number | null;
  error: string | null;
  sync: LocalNodeSyncSnapshot | null;
}

export interface LocalNodeStatusResponse {
  ok: boolean;
  status: LocalNodeStatus;
  backend?: {
    source: "local" | "remote";
    reason: string;
    rpcBaseUrl?: string | null;
    pool?: string[];
  };
}

export interface LocalNodeMetricsResponse {
  ok: boolean;
  uptimeSec: number;
  control: {
    host: string;
    port: number;
    subscribers: number;
    requestsTotal: number;
    routeCounters: Record<string, number>;
    eventsEmittedTotal: number;
    lastError: string | null;
    lastErrorAt: number | null;
  };
  node: {
    startsTotal: number;
    stopsTotal: number;
    restartsTotal: number;
    backendLocalSelectedTotal: number;
    backendRemoteSelectedTotal: number;
    running: boolean;
    rpcHealthy: boolean;
    synced: boolean;
    syncProgressPct: number | null;
    networkProfile: string;
  };
}

export interface LocalNodeControlEvent<T = unknown> {
  type: string;
  at: number;
  payload: T;
}

function controlBaseUrl(): string {
  const raw = String(ENV?.VITE_LOCAL_NODE_CONTROL_URL ?? DEFAULT_LOCAL_NODE_CONTROL_URL).trim();
  return raw.replace(/\/+$/, "") || DEFAULT_LOCAL_NODE_CONTROL_URL;
}

export function getLocalNodeControlBaseUrl(): string {
  return controlBaseUrl();
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = LOCAL_NODE_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${controlBaseUrl()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        typeof data?.error === "string" ? data.error : `Local node control error (${response.status})`,
      );
    }
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Local node control timeout");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function getLocalNodeStatus(): Promise<LocalNodeStatusResponse | null> {
  try {
    return await requestJson<LocalNodeStatusResponse>("/node/status");
  } catch {
    return null;
  }
}

export async function startLocalNode(params: {
  networkProfile: string;
  dataDir?: string | null;
}): Promise<LocalNodeStatusResponse> {
  return requestJson<LocalNodeStatusResponse>("/node/start", {
    method: "POST",
    body: JSON.stringify({
      networkProfile: params.networkProfile,
      dataDir: params.dataDir ?? null,
    }),
  }, LOCAL_NODE_OPERATION_TIMEOUT_MS);
}

export async function stopLocalNode(): Promise<LocalNodeStatusResponse> {
  return requestJson<LocalNodeStatusResponse>("/node/stop", { method: "POST" }, LOCAL_NODE_STOP_TIMEOUT_MS);
}

export async function restartLocalNode(params?: {
  networkProfile?: string;
  dataDir?: string | null;
}): Promise<LocalNodeStatusResponse> {
  return requestJson<LocalNodeStatusResponse>("/node/restart", {
    method: "POST",
    body: JSON.stringify({
      networkProfile: params?.networkProfile ?? null,
      dataDir: params?.dataDir ?? null,
    }),
  }, LOCAL_NODE_OPERATION_TIMEOUT_MS);
}

export async function getLocalNodeLogsTail(lines = 80): Promise<string> {
  try {
    const safeLines = Math.min(400, Math.max(1, Math.floor(lines)));
    const response = await requestJson<{ ok: boolean; logs: string }>(`/node/logs?lines=${safeLines}`);
    return typeof response.logs === "string" ? response.logs : "";
  } catch {
    return "";
  }
}

export async function getLocalNodeMetrics(): Promise<LocalNodeMetricsResponse | null> {
  try {
    return await requestJson<LocalNodeMetricsResponse>("/metrics");
  } catch {
    return null;
  }
}

function parseEventPayload(raw: MessageEvent): LocalNodeControlEvent {
  const payload = typeof raw?.data === "string" ? raw.data : "";
  if (!payload) return { type: "unknown", at: Date.now(), payload: {} };
  try {
    const parsed = JSON.parse(payload);
    if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
      return parsed as LocalNodeControlEvent;
    }
  } catch {
    // fallthrough
  }
  return { type: "unknown", at: Date.now(), payload: { raw: payload } };
}

export function subscribeLocalNodeEvents(
  onEvent: (event: LocalNodeControlEvent) => void,
): () => void {
  if (typeof EventSource === "undefined") return () => {};
  const source = new EventSource(`${controlBaseUrl()}/events`);
  source.onopen = () => {
    onEvent({
      type: "connected",
      at: Date.now(),
      payload: { message: "Local node event stream connected." },
    });
  };
  const listener = (event: MessageEvent) => {
    onEvent(parseEventPayload(event));
  };
  const errorListener = () => {
    onEvent({
      type: "stream_error",
      at: Date.now(),
      payload: { message: "Local node event stream disconnected." },
    });
  };

  source.addEventListener("status", listener as EventListener);
  source.addEventListener("lifecycle", listener as EventListener);
  source.addEventListener("heartbeat", listener as EventListener);
  source.addEventListener("error", listener as EventListener);
  source.onerror = errorListener;

  return () => {
    source.removeEventListener("status", listener as EventListener);
    source.removeEventListener("lifecycle", listener as EventListener);
    source.removeEventListener("heartbeat", listener as EventListener);
    source.removeEventListener("error", listener as EventListener);
    source.close();
  };
}
