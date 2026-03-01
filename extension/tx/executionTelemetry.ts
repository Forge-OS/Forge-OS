import type { PendingTx } from "./types";

const ENV = (import.meta as any)?.env ?? {};
const STORAGE_KEY = "forgeos.execution.audit.v1";
const EXECUTION_TELEMETRY_CHANNELS = ["manual", "swap", "agent"] as const;
const EXECUTION_TELEMETRY_STAGES = ["build", "validate", "sign", "broadcast", "reconcile"] as const;

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number(ENV?.[name]);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function readFloatEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number(ENV?.[name]);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const MAX_EVENTS = readIntEnv("VITE_EXECUTION_AUDIT_MAX_EVENTS", 600, 50, 5000);
const DEFAULT_SLO_WINDOW_MS = readIntEnv("VITE_EXECUTION_SLO_WINDOW_MS", 6 * 60 * 60 * 1000, 60_000, 7 * 24 * 60 * 60 * 1000);
const DEFAULT_SLO_TARGET_PCT = readFloatEnv("VITE_EXECUTION_SLO_TARGET_PCT", 99, 50, 100);
const DEFAULT_SLO_MIN_SAMPLES = readIntEnv("VITE_EXECUTION_SLO_MIN_SAMPLES", 25, 1, 20_000);

export type ExecutionTelemetryChannel = "manual" | "swap" | "agent";
export type ExecutionTelemetryStage = "build" | "validate" | "sign" | "broadcast" | "reconcile";
export type ExecutionTelemetryStatus = "ok" | "failed";

export const EXECUTION_TELEMETRY_CHANNEL_LIST: readonly ExecutionTelemetryChannel[] = EXECUTION_TELEMETRY_CHANNELS;
export const EXECUTION_TELEMETRY_STAGE_LIST: readonly ExecutionTelemetryStage[] = EXECUTION_TELEMETRY_STAGES;

export interface ExecutionTelemetryEvent {
  id: string;
  runId: string;
  channel: ExecutionTelemetryChannel;
  stage: ExecutionTelemetryStage;
  status: ExecutionTelemetryStatus;
  ts: number;
  network: string;
  txId: string | null;
  txState: PendingTx["state"] | null;
  backendSource: "local" | "remote" | null;
  backendReason: string | null;
  backendEndpoint: string | null;
  error: string | null;
  context: Record<string, unknown>;
}

export interface AppendExecutionTelemetryInput {
  runId: string;
  channel: ExecutionTelemetryChannel;
  stage: ExecutionTelemetryStage;
  status: ExecutionTelemetryStatus;
  network: string;
  tx?: PendingTx | null;
  error?: string | null;
  context?: Record<string, unknown>;
}

export interface ExecutionTelemetryCounter {
  total: number;
  ok: number;
  failed: number;
  successRatePct: number;
}

export interface AggregateExecutionTelemetryOptions {
  nowTs?: number;
  windowMs?: number;
  sloTargetPct?: number;
  sloMinSamples?: number;
}

export interface ExecutionTelemetryAggregateSummary {
  nowTs: number;
  fromTs: number;
  windowMs: number;
  totalEvents: number;
  uniqueRuns: number;
  overall: ExecutionTelemetryCounter;
  byChannel: Record<ExecutionTelemetryChannel, ExecutionTelemetryCounter>;
  byStage: Record<ExecutionTelemetryStage, ExecutionTelemetryCounter>;
  byChannelStage: Record<ExecutionTelemetryChannel, Record<ExecutionTelemetryStage, ExecutionTelemetryCounter>>;
  sloTargetPct: number;
  sloMinSamples: number;
  sloEligible: boolean;
  sloMet: boolean;
}

function chromeStorage(): chrome.storage.LocalStorageArea | null {
  if (typeof chrome === "undefined" || !chrome?.storage?.local) return null;
  return chrome.storage.local;
}

function makeEventId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeEvent(value: unknown): ExecutionTelemetryEvent | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id : "";
  const runId = typeof raw.runId === "string" ? raw.runId : "";
  const channel = raw.channel;
  const stage = raw.stage;
  const status = raw.status;
  if (!id || !runId) return null;
  if (channel !== "manual" && channel !== "swap" && channel !== "agent") return null;
  if (stage !== "build" && stage !== "validate" && stage !== "sign" && stage !== "broadcast" && stage !== "reconcile") return null;
  if (status !== "ok" && status !== "failed") return null;
  const ts = Number(raw.ts);
  const txState = typeof raw.txState === "string" ? raw.txState as PendingTx["state"] : null;
  return {
    id,
    runId,
    channel,
    stage,
    status,
    ts: Number.isFinite(ts) ? ts : Date.now(),
    network: typeof raw.network === "string" ? raw.network : "mainnet",
    txId: typeof raw.txId === "string" ? raw.txId : null,
    txState,
    backendSource: raw.backendSource === "local" || raw.backendSource === "remote" ? raw.backendSource : null,
    backendReason: typeof raw.backendReason === "string" ? raw.backendReason : null,
    backendEndpoint: typeof raw.backendEndpoint === "string" ? raw.backendEndpoint : null,
    error: typeof raw.error === "string" ? raw.error : null,
    context: raw.context && typeof raw.context === "object" ? (raw.context as Record<string, unknown>) : {},
  };
}

function normalizeCollection(value: unknown): ExecutionTelemetryEvent[] {
  if (!Array.isArray(value)) return [];
  const out: ExecutionTelemetryEvent[] = [];
  for (const item of value) {
    const normalized = normalizeEvent(item);
    if (normalized) out.push(normalized);
  }
  out.sort((a, b) => b.ts - a.ts);
  return out.slice(0, MAX_EVENTS);
}

async function readEvents(): Promise<ExecutionTelemetryEvent[]> {
  const store = chromeStorage();
  if (!store) return [];
  return new Promise((resolve) => {
    store.get(STORAGE_KEY, (result) => {
      const raw = result?.[STORAGE_KEY];
      if (!raw) {
        resolve([]);
        return;
      }
      if (typeof raw === "string") {
        try {
          resolve(normalizeCollection(JSON.parse(raw)));
          return;
        } catch {
          resolve([]);
          return;
        }
      }
      resolve(normalizeCollection(raw));
    });
  });
}

async function writeEvents(events: ExecutionTelemetryEvent[]): Promise<void> {
  const store = chromeStorage();
  if (!store) return;
  return new Promise((resolve) => {
    store.set({ [STORAGE_KEY]: events }, resolve);
  });
}

export async function appendExecutionTelemetryEvent(
  input: AppendExecutionTelemetryInput,
): Promise<ExecutionTelemetryEvent> {
  const event: ExecutionTelemetryEvent = {
    id: makeEventId(),
    runId: String(input.runId || "").trim() || `run_${makeEventId()}`,
    channel: input.channel,
    stage: input.stage,
    status: input.status,
    ts: Date.now(),
    network: String(input.network || "mainnet"),
    txId: input.tx?.txId ?? null,
    txState: input.tx?.state ?? null,
    backendSource: input.tx?.receiptSourceBackend ?? null,
    backendReason: input.tx?.receiptSourceReason ?? null,
    backendEndpoint: input.tx?.receiptSourceEndpoint ?? null,
    error: input.error ? String(input.error) : null,
    context: input.context ? { ...input.context } : {},
  };

  const store = chromeStorage();
  if (!store) return event;

  const existing = await readEvents();
  const next = [event, ...existing].slice(0, MAX_EVENTS);
  await writeEvents(next);
  return event;
}

export async function listExecutionTelemetryEvents(limit = 120): Promise<ExecutionTelemetryEvent[]> {
  const events = await readEvents();
  const safeLimitRaw = Number(limit);
  const safeLimit = Number.isFinite(safeLimitRaw)
    ? Math.max(1, Math.min(MAX_EVENTS, Math.floor(safeLimitRaw)))
    : Math.min(MAX_EVENTS, 120);
  return events.slice(0, safeLimit);
}

export async function clearExecutionTelemetryEvents(): Promise<void> {
  await writeEvents([]);
}

export function createExecutionRunId(prefix: string): string {
  const safePrefix = String(prefix || "run").toLowerCase().replace(/[^a-z0-9_-]/g, "") || "run";
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${safePrefix}_${crypto.randomUUID()}`;
  }
  return `${safePrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeCounter(ok = 0, failed = 0): ExecutionTelemetryCounter {
  const total = ok + failed;
  const successRatePct = total > 0 ? (ok / total) * 100 : 100;
  return { total, ok, failed, successRatePct };
}

function emptyCounterMapByChannel(): Record<ExecutionTelemetryChannel, { ok: number; failed: number }> {
  return {
    manual: { ok: 0, failed: 0 },
    swap: { ok: 0, failed: 0 },
    agent: { ok: 0, failed: 0 },
  };
}

function emptyCounterMapByStage(): Record<ExecutionTelemetryStage, { ok: number; failed: number }> {
  return {
    build: { ok: 0, failed: 0 },
    validate: { ok: 0, failed: 0 },
    sign: { ok: 0, failed: 0 },
    broadcast: { ok: 0, failed: 0 },
    reconcile: { ok: 0, failed: 0 },
  };
}

function toCounterMapByChannel(
  source: Record<ExecutionTelemetryChannel, { ok: number; failed: number }>,
): Record<ExecutionTelemetryChannel, ExecutionTelemetryCounter> {
  return {
    manual: makeCounter(source.manual.ok, source.manual.failed),
    swap: makeCounter(source.swap.ok, source.swap.failed),
    agent: makeCounter(source.agent.ok, source.agent.failed),
  };
}

function toCounterMapByStage(
  source: Record<ExecutionTelemetryStage, { ok: number; failed: number }>,
): Record<ExecutionTelemetryStage, ExecutionTelemetryCounter> {
  return {
    build: makeCounter(source.build.ok, source.build.failed),
    validate: makeCounter(source.validate.ok, source.validate.failed),
    sign: makeCounter(source.sign.ok, source.sign.failed),
    broadcast: makeCounter(source.broadcast.ok, source.broadcast.failed),
    reconcile: makeCounter(source.reconcile.ok, source.reconcile.failed),
  };
}

export function aggregateExecutionTelemetryEvents(
  events: ExecutionTelemetryEvent[],
  options: AggregateExecutionTelemetryOptions = {},
): ExecutionTelemetryAggregateSummary {
  const nowTs = Number.isFinite(options.nowTs) ? Number(options.nowTs) : Date.now();
  const windowMs = Number.isFinite(options.windowMs)
    ? Math.max(60_000, Math.min(7 * 24 * 60 * 60 * 1000, Math.floor(Number(options.windowMs))))
    : DEFAULT_SLO_WINDOW_MS;
  const fromTs = nowTs - windowMs;
  const sloTargetPct = Number.isFinite(options.sloTargetPct)
    ? Math.max(50, Math.min(100, Number(options.sloTargetPct)))
    : DEFAULT_SLO_TARGET_PCT;
  const sloMinSamples = Number.isFinite(options.sloMinSamples)
    ? Math.max(1, Math.min(20_000, Math.floor(Number(options.sloMinSamples))))
    : DEFAULT_SLO_MIN_SAMPLES;

  const byChannelRaw = emptyCounterMapByChannel();
  const byStageRaw = emptyCounterMapByStage();
  const byChannelStageRaw: Record<ExecutionTelemetryChannel, Record<ExecutionTelemetryStage, { ok: number; failed: number }>> = {
    manual: emptyCounterMapByStage(),
    swap: emptyCounterMapByStage(),
    agent: emptyCounterMapByStage(),
  };

  const runIds = new Set<string>();
  let ok = 0;
  let failed = 0;

  for (const event of events) {
    if (!event || event.ts < fromTs || event.ts > nowTs) continue;
    runIds.add(event.runId);
    if (event.status === "ok") {
      ok += 1;
      byChannelRaw[event.channel].ok += 1;
      byStageRaw[event.stage].ok += 1;
      byChannelStageRaw[event.channel][event.stage].ok += 1;
    } else {
      failed += 1;
      byChannelRaw[event.channel].failed += 1;
      byStageRaw[event.stage].failed += 1;
      byChannelStageRaw[event.channel][event.stage].failed += 1;
    }
  }

  const overall = makeCounter(ok, failed);
  const byChannel = toCounterMapByChannel(byChannelRaw);
  const byStage = toCounterMapByStage(byStageRaw);
  const byChannelStage: Record<ExecutionTelemetryChannel, Record<ExecutionTelemetryStage, ExecutionTelemetryCounter>> = {
    manual: toCounterMapByStage(byChannelStageRaw.manual),
    swap: toCounterMapByStage(byChannelStageRaw.swap),
    agent: toCounterMapByStage(byChannelStageRaw.agent),
  };
  const totalEvents = overall.total;
  const uniqueRuns = runIds.size;
  const sloEligible = totalEvents >= sloMinSamples;
  const sloMet = sloEligible && overall.successRatePct >= sloTargetPct;

  return {
    nowTs,
    fromTs,
    windowMs,
    totalEvents,
    uniqueRuns,
    overall,
    byChannel,
    byStage,
    byChannelStage,
    sloTargetPct,
    sloMinSamples,
    sloEligible,
    sloMet,
  };
}
