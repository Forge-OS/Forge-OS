export interface PendingConnectRequest {
  requestId: string;
  tabId: number;
  origin?: string;
  createdAt: number;
}

export interface PendingSignRequest {
  requestId: string;
  tabId: number;
  origin?: string;
  message: string;
  createdAt: number;
}

export interface PendingRequestState {
  activeConnect: PendingConnectRequest | null;
  activeSign: PendingSignRequest | null;
  connectQueue: PendingConnectRequest[];
  signQueue: PendingSignRequest[];
}

export function emptyPendingRequestState(): PendingRequestState {
  return {
    activeConnect: null,
    activeSign: null,
    connectQueue: [],
    signQueue: [],
  };
}

function coerceCreatedAt(value: unknown, now: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  return now;
}

function parsePendingConnectRequest(value: unknown, now: number): PendingConnectRequest | null {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v.requestId !== "string" || !v.requestId || !Number.isFinite(v.tabId)) return null;
  return {
    requestId: v.requestId,
    tabId: Number(v.tabId),
    origin: typeof v.origin === "string" && v.origin ? v.origin : undefined,
    createdAt: coerceCreatedAt(v.createdAt, now),
  };
}

function parsePendingSignRequest(value: unknown, now: number): PendingSignRequest | null {
  const v = value as Record<string, unknown> | null;
  if (
    !v ||
    typeof v.requestId !== "string" ||
    !v.requestId ||
    !Number.isFinite(v.tabId) ||
    typeof v.message !== "string"
  ) return null;
  return {
    requestId: v.requestId,
    tabId: Number(v.tabId),
    origin: typeof v.origin === "string" && v.origin ? v.origin : undefined,
    message: v.message,
    createdAt: coerceCreatedAt(v.createdAt, now),
  };
}

function sanitizeConnectQueue(value: unknown, now: number): PendingConnectRequest[] {
  if (!Array.isArray(value)) return [];
  const out: PendingConnectRequest[] = [];
  for (const item of value) {
    const parsed = parsePendingConnectRequest(item, now);
    if (parsed) out.push(parsed);
    if (out.length >= 100) break;
  }
  return out;
}

function sanitizeSignQueue(value: unknown, now: number): PendingSignRequest[] {
  if (!Array.isArray(value)) return [];
  const out: PendingSignRequest[] = [];
  for (const item of value) {
    const parsed = parsePendingSignRequest(item, now);
    if (parsed) out.push(parsed);
    if (out.length >= 100) break;
  }
  return out;
}

export function normalizePendingRequestState(raw: {
  activeConnect?: unknown;
  activeSign?: unknown;
  connectQueue?: unknown;
  signQueue?: unknown;
}, now: number = Date.now()): PendingRequestState {
  const connectQueue = sanitizeConnectQueue(raw.connectQueue, now);
  const signQueue = sanitizeSignQueue(raw.signQueue, now);
  const activeConnect = parsePendingConnectRequest(raw.activeConnect, now);
  const activeSign = parsePendingSignRequest(raw.activeSign, now);
  return {
    activeConnect: activeConnect ?? connectQueue.shift() ?? null,
    activeSign: activeSign ?? signQueue.shift() ?? null,
    connectQueue,
    signQueue,
  };
}

export function enqueueConnectRequest(
  state: PendingRequestState,
  request: PendingConnectRequest,
): PendingRequestState {
  const connectQueue = [...state.connectQueue, request];
  const activeConnect = state.activeConnect ?? connectQueue.shift() ?? null;
  return {
    activeConnect,
    activeSign: state.activeSign,
    connectQueue,
    signQueue: [...state.signQueue],
  };
}

export function enqueueSignRequest(
  state: PendingRequestState,
  request: PendingSignRequest,
): PendingRequestState {
  const signQueue = [...state.signQueue, request];
  const activeSign = state.activeSign ?? signQueue.shift() ?? null;
  return {
    activeConnect: state.activeConnect,
    activeSign,
    connectQueue: [...state.connectQueue],
    signQueue,
  };
}

export function resolveActiveConnectRequest(
  state: PendingRequestState,
  requestId?: string,
): { state: PendingRequestState; resolved: PendingConnectRequest | null; stale: boolean } {
  const active = state.activeConnect;
  if (!active) return { state, resolved: null, stale: true };
  if (requestId && requestId !== active.requestId) return { state, resolved: null, stale: true };

  const connectQueue = [...state.connectQueue];
  const next = connectQueue.shift() ?? null;
  return {
    state: {
      activeConnect: next,
      activeSign: state.activeSign,
      connectQueue,
      signQueue: [...state.signQueue],
    },
    resolved: active,
    stale: false,
  };
}

export function resolveActiveSignRequest(
  state: PendingRequestState,
  requestId?: string,
): { state: PendingRequestState; resolved: PendingSignRequest | null; stale: boolean } {
  const active = state.activeSign;
  if (!active) return { state, resolved: null, stale: true };
  if (requestId && requestId !== active.requestId) return { state, resolved: null, stale: true };

  const signQueue = [...state.signQueue];
  const next = signQueue.shift() ?? null;
  return {
    state: {
      activeConnect: state.activeConnect,
      activeSign: next,
      connectQueue: [...state.connectQueue],
      signQueue,
    },
    resolved: active,
    stale: false,
  };
}

export function pendingRequestCount(state: PendingRequestState): number {
  return state.connectQueue.length
    + state.signQueue.length
    + (state.activeConnect ? 1 : 0)
    + (state.activeSign ? 1 : 0);
}

export function dropRequestsForTab(
  state: PendingRequestState,
  tabId: number,
): {
  state: PendingRequestState;
  removedConnect: PendingConnectRequest[];
  removedSign: PendingSignRequest[];
} {
  const removedConnect: PendingConnectRequest[] = [];
  const removedSign: PendingSignRequest[] = [];

  let activeConnect = state.activeConnect;
  let activeSign = state.activeSign;

  if (activeConnect?.tabId === tabId) {
    removedConnect.push(activeConnect);
    activeConnect = null;
  }
  if (activeSign?.tabId === tabId) {
    removedSign.push(activeSign);
    activeSign = null;
  }

  const keptConnectQueue = state.connectQueue.filter((req) => {
    if (req.tabId === tabId) {
      removedConnect.push(req);
      return false;
    }
    return true;
  });
  const keptSignQueue = state.signQueue.filter((req) => {
    if (req.tabId === tabId) {
      removedSign.push(req);
      return false;
    }
    return true;
  });

  if (!activeConnect) activeConnect = keptConnectQueue.shift() ?? null;
  if (!activeSign) activeSign = keptSignQueue.shift() ?? null;

  return {
    state: {
      activeConnect,
      activeSign,
      connectQueue: keptConnectQueue,
      signQueue: keptSignQueue,
    },
    removedConnect,
    removedSign,
  };
}

export function requestOriginKey(origin?: string): string {
  const key = typeof origin === "string" ? origin.trim().toLowerCase() : "";
  return key || "__unknown_origin__";
}

export function countOriginRequests(state: PendingRequestState, originKey: string): number {
  const key = requestOriginKey(originKey);
  let count = 0;
  if (state.activeConnect && requestOriginKey(state.activeConnect.origin) === key) count++;
  if (state.activeSign && requestOriginKey(state.activeSign.origin) === key) count++;
  count += state.connectQueue.filter((r) => requestOriginKey(r.origin) === key).length;
  count += state.signQueue.filter((r) => requestOriginKey(r.origin) === key).length;
  return count;
}

export function pruneExpiredRequests(
  state: PendingRequestState,
  now: number,
  ttlMs: number,
): {
  state: PendingRequestState;
  expiredConnect: PendingConnectRequest[];
  expiredSign: PendingSignRequest[];
} {
  const expiresBefore = now - Math.max(1, ttlMs);
  const expiredConnect: PendingConnectRequest[] = [];
  const expiredSign: PendingSignRequest[] = [];

  let activeConnect = state.activeConnect;
  let activeSign = state.activeSign;
  const connectQueue = [...state.connectQueue];
  const signQueue = [...state.signQueue];

  if (activeConnect && activeConnect.createdAt <= expiresBefore) {
    expiredConnect.push(activeConnect);
    activeConnect = null;
  }
  if (activeSign && activeSign.createdAt <= expiresBefore) {
    expiredSign.push(activeSign);
    activeSign = null;
  }

  const keptConnectQueue = connectQueue.filter((req) => {
    if (req.createdAt <= expiresBefore) {
      expiredConnect.push(req);
      return false;
    }
    return true;
  });

  const keptSignQueue = signQueue.filter((req) => {
    if (req.createdAt <= expiresBefore) {
      expiredSign.push(req);
      return false;
    }
    return true;
  });

  if (!activeConnect) activeConnect = keptConnectQueue.shift() ?? null;
  if (!activeSign) activeSign = keptSignQueue.shift() ?? null;

  return {
    state: {
      activeConnect,
      activeSign,
      connectQueue: keptConnectQueue,
      signQueue: keptSignQueue,
    },
    expiredConnect,
    expiredSign,
  };
}
