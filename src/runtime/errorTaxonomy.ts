export type ForgeErrorDomain = "wallet" | "rpc" | "ai" | "tx" | "lifecycle" | "system";

export type ForgeErrorCode =
  | "WALLET_UNAVAILABLE"
  | "WALLET_TIMEOUT"
  | "WALLET_USER_REJECTED"
  | "WALLET_PROVIDER_INVALID"
  | "WALLET_NETWORK_MISMATCH"
  | "RPC_UNAVAILABLE"
  | "RPC_TIMEOUT"
  | "RPC_RATE_LIMIT"
  | "RPC_RESPONSE_INVALID"
  | "AI_UNAVAILABLE"
  | "AI_TIMEOUT"
  | "TX_INVALID"
  | "TX_BROADCAST_FAILED"
  | "TX_REJECTED"
  | "LIFECYCLE_INVALID_TRANSITION"
  | "UNKNOWN";

export class ForgeError extends Error {
  domain: ForgeErrorDomain;
  code: ForgeErrorCode;
  retryable: boolean;
  details?: Record<string, any>;
  cause?: unknown;

  constructor(params: {
    message: string;
    domain: ForgeErrorDomain;
    code: ForgeErrorCode;
    retryable?: boolean;
    details?: Record<string, any>;
    cause?: unknown;
  }) {
    super(params.message);
    this.name = "ForgeError";
    this.domain = params.domain;
    this.code = params.code;
    this.retryable = Boolean(params.retryable);
    this.details = params.details;
    this.cause = params.cause;
  }
}

export function isForgeError(err: unknown): err is ForgeError {
  return err instanceof ForgeError;
}

// Pre-compiled patterns — avoids re-creating RegExp on every error inference call
const RE_WALLET_TIMEOUT = /timeout/;
const RE_WALLET_REJECTED = /rejected|denied|cancel/;
const RE_WALLET_NETWORK = /network/;
const RE_WALLET_MISMATCH = /mismatch|expected|switch/;
const RE_WALLET_UNAVAILABLE = /not detected|unavailable|not connected|browser wallet apis unavailable/;
const RE_WALLET_PROVIDER = /provider missing|invalid/;
const RE_RPC_RATE = /429|rate/i;
const RE_RPC_INVALID = /invalid/;
const RE_RPC_TIMEOUT = /timeout/;
const RE_TX_INVALID = /invalid/;
const RE_TX_REJECTED = /rejected|denied|cancel/;
const RE_RETRYABLE = /(timeout|network|unavailable|429|503|502|504)/i;

export function makeForgeError(params: ConstructorParameters<typeof ForgeError>[0]) {
  return new ForgeError(params);
}

function inferCode(domain: ForgeErrorDomain, message: string): ForgeErrorCode {
  const msg = String(message || "").toLowerCase();
  if (domain === "wallet") {
    if (RE_WALLET_TIMEOUT.test(msg)) return "WALLET_TIMEOUT";
    if (RE_WALLET_REJECTED.test(msg)) return "WALLET_USER_REJECTED";
    if (RE_WALLET_NETWORK.test(msg) && RE_WALLET_MISMATCH.test(msg)) return "WALLET_NETWORK_MISMATCH";
    if (RE_WALLET_UNAVAILABLE.test(msg)) return "WALLET_UNAVAILABLE";
    if (RE_WALLET_PROVIDER.test(msg)) return "WALLET_PROVIDER_INVALID";
  }
  if (domain === "rpc") {
    if (RE_RPC_TIMEOUT.test(msg)) return "RPC_TIMEOUT";
    if (RE_RPC_RATE.test(msg)) return "RPC_RATE_LIMIT";
    if (RE_RPC_INVALID.test(msg)) return "RPC_RESPONSE_INVALID";
    return "RPC_UNAVAILABLE";
  }
  if (domain === "ai") {
    if (RE_RPC_TIMEOUT.test(msg)) return "AI_TIMEOUT";
    return "AI_UNAVAILABLE";
  }
  if (domain === "tx") {
    if (RE_TX_INVALID.test(msg)) return "TX_INVALID";
    if (RE_TX_REJECTED.test(msg)) return "TX_REJECTED";
    return "TX_BROADCAST_FAILED";
  }
  if (domain === "lifecycle") return "LIFECYCLE_INVALID_TRANSITION";
  return "UNKNOWN";
}

export function normalizeError(err: unknown, fallback: {
  domain?: ForgeErrorDomain;
  code?: ForgeErrorCode;
  message?: string;
  retryable?: boolean;
  details?: Record<string, any>;
} = {}) {
  if (isForgeError(err)) return err;

  const rawMessage = String((err as any)?.message || err || fallback.message || "Unknown error");
  const domain = fallback.domain || "system";
  const code = fallback.code || inferCode(domain, rawMessage);
  const retryable = typeof fallback.retryable === "boolean"
    ? fallback.retryable
    : RE_RETRYABLE.test(rawMessage);

  return new ForgeError({
    message: rawMessage,
    domain,
    code,
    retryable,
    details: fallback.details,
    cause: err,
  });
}

export function formatForgeError(err: unknown) {
  const fx = normalizeError(err);
  return `${fx.code}: ${fx.message}`;
}

export function walletError(err: unknown, details?: Record<string, any>) {
  return normalizeError(err, { domain: "wallet", details });
}

export function rpcError(err: unknown, details?: Record<string, any>) {
  return normalizeError(err, { domain: "rpc", details });
}

export function txError(err: unknown, details?: Record<string, any>) {
  return normalizeError(err, { domain: "tx", details });
}
