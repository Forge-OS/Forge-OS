export type AlertEventType = "risk_event" | "queue_pending" | "ai_outage" | "regime_shift" | "system" | "tx_failure" | "confirmation_timeout" | "low_balance" | "network_disconnect";

export type AlertConfig = {
  version: number;
  updatedAt: number;
  enabled: boolean;
  minIntervalSec: number;
  discordWebhookUrl: string;
  telegramBotApiUrl: string;
  telegramChatId: string;
  emailWebhookUrl: string;
  eventToggles: Record<AlertEventType, boolean>;
  queuePendingThreshold: number;
  lowBalanceThreshold: number;
};

export type AlertEvent = {
  type: AlertEventType;
  key?: string;
  title: string;
  message: string;
  severity?: "info" | "warn" | "danger";
  scope?: string;
  ts?: number;
  meta?: Record<string, any>;
  repeatCount?: number;
  escalatedFrom?: "info" | "warn";
};

const STORAGE_PREFIX = "forgeos.alerts.v1";
const DEDUPE_PREFIX = "forgeos.alerts.dedupe.v1";
const MAX_MSG = 1200;
const memoryThrottle = new Map<string, number>();
const MAX_MEMORY_THROTTLE_KEYS = 1024;

const DEFAULT_CONFIG: AlertConfig = {
  version: 1,
  updatedAt: 0,
  enabled: false,
  minIntervalSec: 90,
  discordWebhookUrl: "",
  telegramBotApiUrl: "",
  telegramChatId: "",
  emailWebhookUrl: "",
  eventToggles: {
    risk_event: true,
    queue_pending: true,
    ai_outage: true,
    regime_shift: true,
    system: false,
    tx_failure: true,
    confirmation_timeout: true,
    low_balance: true,
    network_disconnect: true,
  },
  queuePendingThreshold: 3,
  lowBalanceThreshold: 100,
};

function normalizeScope(scope: string) {
  return String(scope || "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]/g, "_")
    .slice(0, 180);
}

function cfgKey(scope: string) {
  return `${STORAGE_PREFIX}:${normalizeScope(scope) || "default"}`;
}

function dedupeKey(scope: string, key: string) {
  return `${DEDUPE_PREFIX}:${normalizeScope(scope) || "default"}:${String(key || "event").slice(0, 120)}`;
}

function finite(v: any, fallback: number) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function sanitizeUrl(v: any) {
  const s = String(v || "").trim();
  return s.slice(0, 500);
}

function sanitizeConfig(raw: any): AlertConfig {
  const toggles = { ...DEFAULT_CONFIG.eventToggles };
  for (const key of Object.keys(toggles) as AlertEventType[]) {
    if (typeof raw?.eventToggles?.[key] === "boolean") toggles[key] = raw.eventToggles[key];
  }
  return {
    version: 1,
    updatedAt: Date.now(),
    enabled: Boolean(raw?.enabled),
    minIntervalSec: clamp(finite(raw?.minIntervalSec, DEFAULT_CONFIG.minIntervalSec), 15, 3600),
    discordWebhookUrl: sanitizeUrl(raw?.discordWebhookUrl),
    telegramBotApiUrl: sanitizeUrl(raw?.telegramBotApiUrl),
    telegramChatId: String(raw?.telegramChatId || "").trim().slice(0, 120),
    emailWebhookUrl: sanitizeUrl(raw?.emailWebhookUrl),
    eventToggles: toggles,
    queuePendingThreshold: clamp(finite(raw?.queuePendingThreshold, DEFAULT_CONFIG.queuePendingThreshold), 1, 50),
    lowBalanceThreshold: clamp(finite(raw?.lowBalanceThreshold, DEFAULT_CONFIG.lowBalanceThreshold), 0, 100000),
  };
}

export function defaultAlertConfig() {
  return sanitizeConfig(DEFAULT_CONFIG);
}

export function readAlertConfig(scope: string): AlertConfig {
  if (typeof window === "undefined") return defaultAlertConfig();
  try {
    const raw = window.localStorage.getItem(cfgKey(scope));
    if (!raw) return defaultAlertConfig();
    return sanitizeConfig(JSON.parse(raw));
  } catch {
    return defaultAlertConfig();
  }
}

export function writeAlertConfig(scope: string, cfg: AlertConfig) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(cfgKey(scope), JSON.stringify(sanitizeConfig(cfg)));
  } catch {
    // Ignore storage failures.
  }
}

function shouldThrottle(scope: string, cfg: AlertConfig, evt: AlertEvent) {
  const key = evt.key || `${evt.type}:${evt.title}`;
  const throttleMs = Math.max(15, cfg.minIntervalSec) * 1000;
  const now = Date.now();
  const memKey = `${normalizeScope(scope)}:${key}`;
  const lastMem = memoryThrottle.get(memKey) || 0;
  if (now - lastMem < throttleMs) return true;

  if (typeof window !== "undefined") {
    try {
      const storage = window.localStorage.getItem(dedupeKey(scope, key));
      const last = storage ? Number(storage) : 0;
      if (Number.isFinite(last) && now - last < throttleMs) return true;
    } catch {
      // Ignore storage failures.
    }
  }

  memoryThrottle.set(memKey, now);
  if (memoryThrottle.size > MAX_MEMORY_THROTTLE_KEYS) {
    const cutoff = now - throttleMs * 4;
    for (const [k, ts] of memoryThrottle.entries()) {
      if (ts < cutoff) memoryThrottle.delete(k);
      if (memoryThrottle.size <= MAX_MEMORY_THROTTLE_KEYS) break;
    }
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(dedupeKey(scope, key), String(now));
    } catch {
      // Ignore storage failures.
    }
  }
  return false;
}

function alertText(evt: AlertEvent) {
  const severity = String(evt.severity || "info").toUpperCase();
  const ts = new Date(evt.ts || Date.now()).toISOString();
  
  // Build enhanced header with escalation info
  let header = "[ForgeOS][" + severity + "] " + evt.title;
  if (evt.repeatCount && evt.repeatCount > 1) {
    header = "[ForgeOS][" + severity + "] " + evt.title + " (" + evt.repeatCount + "x)";
  }
  if (evt.escalatedFrom) {
    header += " [ESCALATED from " + evt.escalatedFrom.toUpperCase() + "]";
  }
  
  // Build enhanced body with all metadata
  let body = evt.message;
  if (evt.meta) {
    const metaLines: string[] = [];
    for (const [k, v] of Object.entries(evt.meta)) {
      if (v !== undefined && v !== null) {
        metaLines.push(k + "=" + (typeof v === "object" ? JSON.stringify(v) : v));
      }
    }
    if (metaLines.length > 0) {
      body += "\n" + metaLines.join(" | ");
    }
  }
  
  return (header + "\n" + body + "\n" + ts).slice(0, MAX_MSG);
}

const ALERT_SERVER_URL = typeof window !== "undefined" 
  ? (window as any).__forgeosAlertServerUrl || "" 
  : "";

// CORS proxy for direct webhook calls (free, public proxy)
const CORS_PROXY = "https://corsproxy.io/?";

async function postJson(url: string, body: any) {
  // Use CORS proxy to avoid CORS issues when calling webhooks directly from browser
  const proxyUrl = url.startsWith("http") ? CORS_PROXY + encodeURIComponent(url) : url;
  const res = await fetch(proxyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("alert_webhook_" + res.status);
  return true;
}

async function sendViaServer(scope: string, evt: AlertEvent, config: AlertConfig): Promise<{sent: boolean, sentCount?: number, failures?: string[]}> {
  if (!ALERT_SERVER_URL) {
    // Fallback to direct webhooks if no server URL configured
    return { sent: false, failures: ["no_server_configured"] };
  }
  
  try {
    const response = await fetch(`${ALERT_SERVER_URL}/v1/alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope,
        type: evt.type,
        key: evt.key,
        title: evt.title,
        message: evt.message,
        severity: evt.severity,
        ts: evt.ts,
        meta: evt.meta,
        repeatCount: evt.repeatCount,
        escalatedFrom: evt.escalatedFrom,
        config,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "unknown" }));
      throw new Error(error.error || "server_error");
    }
    
    return await response.json();
  } catch (error: any) {
    throw new Error("server_" + (error.message || "unknown"));
  }
}

async function sendDiscord(url: string, evt: AlertEvent) {
  if (!url) return false;
  await postJson(url, { content: alertText(evt) });
  return true;
}

async function sendTelegram(botApiUrl: string, chatId: string, evt: AlertEvent) {
  if (!botApiUrl || !chatId) return false;
  await postJson(botApiUrl, {
    chat_id: chatId,
    text: alertText(evt),
    disable_web_page_preview: true,
  });
  return true;
}

async function sendEmailWebhook(url: string, evt: AlertEvent) {
  if (!url) return false;
  await postJson(url, {
    subject: "[ForgeOS] " + evt.title,
    message: alertText(evt),
    event: evt,
  });
  return true;
}

export async function emitAlert(scope: string, evt: AlertEvent, overrideConfig?: AlertConfig) {
  const cfg = sanitizeConfig(overrideConfig || readAlertConfig(scope));
  if (!cfg.enabled) return { sent: false, reason: "disabled" as const };
  if (!cfg.eventToggles[evt.type]) return { sent: false, reason: "event_disabled" as const };
  const hasAnyRoute =
    Boolean(cfg.discordWebhookUrl) ||
    (Boolean(cfg.telegramBotApiUrl) && Boolean(cfg.telegramChatId)) ||
    Boolean(cfg.emailWebhookUrl);
  if (!hasAnyRoute) return { sent: false, reason: "no_routes_configured" as const };
  if (shouldThrottle(scope, cfg, evt)) return { sent: false, reason: "throttled" as const };

  // Try server-side forwarding first if configured
  if (ALERT_SERVER_URL) {
    try {
      const result = await sendViaServer(scope, evt, cfg);
      if (result.sent) {
        return { sent: true, sentCount: result.sentCount || 1, failures: result.failures };
      }
      // If server returned but couldn't send, fall through to direct
    } catch (e) {
      // Server failed, fall through to direct webhooks
    }
  }

  // Fallback: direct webhook calls from browser
  const failures: string[] = [];
  let sentCount = 0;

  try {
    if (await sendDiscord(cfg.discordWebhookUrl, evt)) sentCount += 1;
  } catch (e: any) {
    failures.push("discord:" + (e?.message || "send_failed"));
  }
  try {
    if (await sendTelegram(cfg.telegramBotApiUrl, cfg.telegramChatId, evt)) sentCount += 1;
  } catch (e: any) {
    failures.push("telegram:" + (e?.message || "send_failed"));
  }
  try {
    if (await sendEmailWebhook(cfg.emailWebhookUrl, evt)) sentCount += 1;
  } catch (e: any) {
    failures.push("email:" + (e?.message || "send_failed"));
  }

  if (sentCount === 0 && failures.length) {
    return { sent: false, reason: "delivery_failed" as const, failures };
  }
  return { sent: sentCount > 0, sentCount, failures };
}

