import type { SwapRouteSource } from "./types";

export interface SwapSigningDomainContext {
  routeSource: SwapRouteSource;
  hasManagedKaspaSession: boolean;
  hasExternalEvmSigner: boolean;
}

export interface SwapSigningDomainResult {
  ok: boolean;
  requiredDomain: "kaspa_managed" | "evm_sidecar";
  reason: string | null;
}

export interface ExpectedEip712Domain {
  name: string;
  chainId: number;
  verifyingContract: string;
}

export interface Eip712DomainInput {
  name?: unknown;
  chainId?: unknown;
  verifyingContract?: unknown;
}

function normalizeHexAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function enforceSwapSigningDomain(
  ctx: SwapSigningDomainContext,
): SwapSigningDomainResult {
  if (ctx.routeSource === "evm_0x") {
    if (!ctx.hasExternalEvmSigner) {
      return {
        ok: false,
        requiredDomain: "evm_sidecar",
        reason: "0x route requires an external EVM signer. Kaspa managed signer is isolated.",
      };
    }
    return { ok: true, requiredDomain: "evm_sidecar", reason: null };
  }

  if (!ctx.hasManagedKaspaSession) {
    return {
      ok: false,
      requiredDomain: "kaspa_managed",
      reason: "Kaspa managed wallet must be unlocked for Kaspa-native swap.",
    };
  }
  return { ok: true, requiredDomain: "kaspa_managed", reason: null };
}

export function validateEip712Domain(
  domain: Eip712DomainInput,
  expected: ExpectedEip712Domain,
): string[] {
  const errors: string[] = [];
  const name = typeof domain?.name === "string" ? domain.name : "";
  const chainId = typeof domain?.chainId === "number" ? domain.chainId : Number(domain?.chainId);
  const verifyingContract =
    typeof domain?.verifyingContract === "string" ? domain.verifyingContract : "";

  if (!name || name !== expected.name) {
    errors.push(`EIP712_DOMAIN_NAME_MISMATCH: expected "${expected.name}".`);
  }
  if (!Number.isFinite(chainId) || Number(chainId) !== expected.chainId) {
    errors.push(`EIP712_DOMAIN_CHAIN_MISMATCH: expected chainId ${expected.chainId}.`);
  }
  if (
    !verifyingContract
    || normalizeHexAddress(verifyingContract) !== normalizeHexAddress(expected.verifyingContract)
  ) {
    errors.push("EIP712_DOMAIN_CONTRACT_MISMATCH: unexpected verifying contract.");
  }

  return errors;
}

export function validateSwapTransactionTarget(
  actualTo: string,
  expectedTo: string,
): boolean {
  if (!actualTo || !expectedTo) return false;
  return normalizeHexAddress(actualTo) === normalizeHexAddress(expectedTo);
}
