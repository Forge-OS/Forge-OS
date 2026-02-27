import type { TokenId } from "../tokens/types";
import { SWAP_CONFIG, type SwapRouteSource } from "./types";

export interface SwapRouteDecision {
  source: SwapRouteSource;
  label: string;
  allowed: boolean;
  reason: string | null;
  requiresEvmSigner: boolean;
}

export interface ResolveSwapRouteOptions {
  // When true (default), kaspa_native source can auto-switch to evm_0x
  // for non-KAS pairs. Set false to pin the source strictly.
  allowHybridAuto?: boolean;
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
  options: ResolveSwapRouteOptions = {},
): SwapRouteDecision {
  const allowHybridAuto = options.allowHybridAuto !== false;

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
    // Hybrid behavior:
    // - Keep KAS-involved pairs on Kaspa-native route.
    // - Auto-route non-KAS pairs to 0x EVM so the wallet build can serve
    //   both route domains without forcing a global mode switch.
    if (allowHybridAuto && !tokenPairIncludesKaspaNative(tokenIn, tokenOut)) {
      return {
        source: "evm_0x",
        label: routeLabel("evm_0x"),
        allowed: true,
        reason: null,
        requiresEvmSigner: true,
      };
    }

    if (tokenPairIncludes0xToken(tokenIn, tokenOut)) {
      return {
        source,
        label: routeLabel(source),
        allowed: false,
        reason: "0x routes are EVM-domain only and cannot bridge directly with native KAS.",
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
