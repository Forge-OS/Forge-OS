// 0x adapter scaffolding.
// This module is intentionally fail-closed until production 0x EVM sidecar
// signing is fully integrated and audited.
import type { TokenId } from "../tokens/types";
import type { SwapRequest } from "./types";
import type { EvmSidecarSession } from "./evmSidecar";

export interface ZeroExQuoteAllowanceIssue {
  spender?: string;
}

export interface ZeroExQuoteTransaction {
  to?: string;
  data?: string;
  value?: string;
}

export interface ZeroExQuote {
  chainId?: number;
  sellToken?: string;
  buyToken?: string;
  sellAmount?: string;
  buyAmount?: string;
  minBuyAmount?: string;
  liquidityAvailable?: boolean;
  zrxVersion?: string;
  transaction?: ZeroExQuoteTransaction;
  route?: {
    fills?: Array<{ source?: string }>;
    tokens?: Array<{ address?: string; symbol?: string }>;
  };
  issues?: {
    allowance?: ZeroExQuoteAllowanceIssue;
    simulationIncomplete?: boolean;
  };
}

export interface ZeroExQuotePolicy {
  allowedChainIds: number[];
  expectedChainId?: number;
  expectedSettlerTo: string;
  expectedAllowanceSpender?: string;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

const EVM_TOKEN_ADDRESS_MAP: Record<number, Partial<Record<TokenId, string>>> = {
  1: {
    USDC: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    ZRX: "0xE41d2489571d322189246DaFA5ebDe1F4699F498",
  },
};

export interface ZeroExQuoteFetchConfig {
  endpoint: string;
  apiKey?: string;
  expectedSettlerTo: string;
  expectedAllowanceSpender?: string;
  slippageBps: number;
  sellTokenAddress: string;
  buyTokenAddress: string;
  sellAmount: string;
}

export function resolveEvmTokenAddress(tokenId: TokenId, chainId: number): string | null {
  if (tokenId === "KAS") return null;
  const map = EVM_TOKEN_ADDRESS_MAP[chainId] ?? {};
  const address = map[tokenId];
  return typeof address === "string" && address ? address : null;
}

export function buildZeroExQuoteFetchConfig(
  req: SwapRequest,
  session: EvmSidecarSession,
  policy: {
    endpoint: string;
    expectedSettlerTo: string;
    expectedAllowanceSpender?: string;
    apiKey?: string;
  },
): ZeroExQuoteFetchConfig {
  const sellTokenAddress = resolveEvmTokenAddress(req.tokenIn, session.chainId);
  const buyTokenAddress = resolveEvmTokenAddress(req.tokenOut, session.chainId);
  if (!sellTokenAddress || !buyTokenAddress) {
    throw new Error("ZEROX_TOKEN_UNSUPPORTED: token pair is not mapped for selected EVM chain.");
  }
  return {
    endpoint: policy.endpoint,
    apiKey: policy.apiKey,
    expectedSettlerTo: policy.expectedSettlerTo,
    expectedAllowanceSpender: policy.expectedAllowanceSpender,
    slippageBps: req.slippageBps,
    sellTokenAddress,
    buyTokenAddress,
    sellAmount: req.amountIn.toString(),
  };
}

export async function fetchZeroExQuote(
  cfg: ZeroExQuoteFetchConfig,
  allowedChainIds: number[],
  expectedChainId?: number,
): Promise<ZeroExQuote> {
  const qs = new URLSearchParams({
    sellToken: cfg.sellTokenAddress,
    buyToken: cfg.buyTokenAddress,
    sellAmount: cfg.sellAmount,
    slippageBps: String(cfg.slippageBps),
  });
  const url = `${cfg.endpoint}?${qs.toString()}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (cfg.apiKey) headers["0x-api-key"] = cfg.apiKey;

  const res = await fetch(url, { method: "GET", headers });
  const raw = (await res.json().catch(() => ({}))) as ZeroExQuote & { reason?: string };
  if (!res.ok) {
    const reason = typeof raw?.reason === "string" ? raw.reason : `HTTP ${res.status}`;
    throw new Error(`ZEROX_QUOTE_FAILED: ${reason}`);
  }

  const errors = validateZeroExQuotePolicy(raw, {
    allowedChainIds,
    expectedChainId,
    expectedSettlerTo: cfg.expectedSettlerTo,
    expectedAllowanceSpender: cfg.expectedAllowanceSpender,
  });
  if (raw.issues?.simulationIncomplete) {
    errors.push("ZEROX_SIMULATION_INCOMPLETE");
  }
  if (errors.length > 0) {
    throw new Error(`ZEROX_POLICY_REJECTED: ${errors.join(", ")}`);
  }
  return raw;
}

export function validateZeroExQuotePolicy(
  quote: ZeroExQuote,
  policy: ZeroExQuotePolicy,
): string[] {
  const errors: string[] = [];
  const chainId = Number(quote.chainId ?? 0);
  if (!Number.isFinite(chainId) || !policy.allowedChainIds.includes(chainId)) {
    errors.push("ZEROX_CHAIN_NOT_ALLOWED");
  }
  if (policy.expectedChainId && chainId !== policy.expectedChainId) {
    errors.push("ZEROX_CHAIN_SESSION_MISMATCH");
  }

  if (!quote.liquidityAvailable) {
    errors.push("ZEROX_NO_LIQUIDITY");
  }

  const txTo = typeof quote.transaction?.to === "string" ? quote.transaction.to : "";
  if (!txTo || normalize(txTo) !== normalize(policy.expectedSettlerTo)) {
    errors.push("ZEROX_SETTLER_MISMATCH");
  }

  if (policy.expectedAllowanceSpender) {
    const spender = typeof quote.issues?.allowance?.spender === "string"
      ? quote.issues.allowance.spender
      : "";
    if (!spender || normalize(spender) !== normalize(policy.expectedAllowanceSpender)) {
      errors.push("ZEROX_ALLOWANCE_SPENDER_MISMATCH");
    }
  }

  if (!quote.minBuyAmount || !/^\d+$/.test(String(quote.minBuyAmount))) {
    errors.push("ZEROX_MIN_BUY_AMOUNT_INVALID");
  }

  return errors;
}
