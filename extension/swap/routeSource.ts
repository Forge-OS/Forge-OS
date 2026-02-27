import type { TokenId } from "../tokens/types";
import { SWAP_CONFIG, type SwapRouteSource } from "./types";

export interface SwapRouteDecision {
  source: SwapRouteSource;
  label: string;
  allowed: boolean;
  reason: string | null;
  requiresEvmSigner: boolean;
}

function routeLabel(source: SwapRouteSource): string {
  switch (source) {
    case "kaspa_native":
      return "Kaspa Native";
    case "evm_0x":
      return "0x EVM";
    case "blocked":
    default:
      return "Blocked";
  }
}

function tokenPairIncludesKaspaNative(tokenIn: TokenId, tokenOut: TokenId): boolean {
  return tokenIn === "KAS" || tokenOut === "KAS";
}

function tokenPairIncludes0xToken(tokenIn: TokenId, tokenOut: TokenId): boolean {
  return tokenIn === "ZRX" || tokenOut === "ZRX";
}

export function resolveSwapRouteSource(
  tokenIn: TokenId,
  tokenOut: TokenId,
  source: SwapRouteSource = SWAP_CONFIG.routeSource,
): SwapRouteDecision {
  if (source === "blocked") {
    return {
      source,
      label: routeLabel(source),
      allowed: false,
      reason: "Swap routes are currently disabled on Kaspa.",
      requiresEvmSigner: false,
    };
  }

  if (source === "kaspa_native") {
    if (tokenPairIncludes0xToken(tokenIn, tokenOut)) {
      return {
        source,
        label: routeLabel(source),
        allowed: false,
        reason: "0x token routes are not enabled on Kaspa-native swap.",
        requiresEvmSigner: false,
      };
    }
    return {
      source,
      label: routeLabel(source),
      allowed: true,
      reason: null,
      requiresEvmSigner: false,
    };
  }

  // evm_0x
  if (tokenPairIncludesKaspaNative(tokenIn, tokenOut)) {
    return {
      source,
      label: routeLabel(source),
      allowed: false,
      reason: "0x routes are EVM-domain only and cannot use native Kaspa balances directly.",
      requiresEvmSigner: true,
    };
  }

  return {
    source,
    label: routeLabel(source),
    allowed: true,
    reason: null,
    requiresEvmSigner: true,
  };
}

export function getRouteSourceCapabilities(
  source: SwapRouteSource = SWAP_CONFIG.routeSource,
): SwapRouteDecision {
  if (source === "blocked") {
    return {
      source,
      label: routeLabel(source),
      allowed: false,
      reason: "Swap routes are currently disabled on Kaspa.",
      requiresEvmSigner: false,
    };
  }
  if (source === "evm_0x") {
    return {
      source,
      label: routeLabel(source),
      allowed: true,
      reason: null,
      requiresEvmSigner: true,
    };
  }
  return {
    source,
    label: routeLabel(source),
    allowed: true,
    reason: null,
    requiresEvmSigner: false,
  };
}

export function getConfiguredSwapRouteInfo(): SwapRouteDecision {
  return getRouteSourceCapabilities(SWAP_CONFIG.routeSource);
}
