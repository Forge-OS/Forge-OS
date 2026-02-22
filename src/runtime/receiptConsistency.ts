type ReceiptConsistencyStatus = "insufficient" | "consistent" | "mismatch";

export type ReceiptConsistencyResult = {
  status: ReceiptConsistencyStatus;
  mismatches: string[];
  confirmTsDriftMs?: number;
  feeDiffKas?: number;
  slippageDiffKas?: number;
  checkedTs: number;
};

export type ReceiptConsistencyTolerances = {
  confirmTsDriftMs: number;
  feeKasTolerance: number;
  slippageKasTolerance: number;
};

const n = (v: any, fallback = 0) => {
  const out = Number(v);
  return Number.isFinite(out) ? out : fallback;
};

function deriveChainSlippageKas(item: any) {
  const amountKas = Math.max(0, n(item?.amount_kas, 0));
  const p0 = n(item?.broadcast_price_usd, 0);
  const p1 = n(item?.confirm_price_usd, 0);
  if (!(amountKas > 0) || !(p0 > 0) || !(p1 > 0)) return null;
  const movePct = Math.abs((p1 - p0) / p0);
  return Number((amountKas * movePct).toFixed(8));
}

export function deriveReceiptConsistency(item: any, tolerances: ReceiptConsistencyTolerances): ReceiptConsistencyResult {
  const checkedTs = Date.now();
  const mismatches: string[] = [];

  const chainConfirmTs = Math.max(0, n(item?.chain_confirm_ts ?? item?.confirm_ts, 0));
  const backendConfirmTs = Math.max(0, n(item?.backend_confirm_ts, 0));
  const hasConfirmTsPair = chainConfirmTs > 0 && backendConfirmTs > 0;
  const confirmTsDriftMs = hasConfirmTsPair ? Math.abs(chainConfirmTs - backendConfirmTs) : undefined;
  if (typeof confirmTsDriftMs === "number" && confirmTsDriftMs > Math.max(0, n(tolerances?.confirmTsDriftMs, 0))) {
    mismatches.push("confirm_ts");
  }

  const chainFeeKas = n(item?.chain_receipt_fee_kas ?? item?.receipt_fee_kas, NaN);
  const backendFeeKas = n(item?.backend_receipt_fee_kas, NaN);
  const hasFeePair = Number.isFinite(chainFeeKas) && Number.isFinite(backendFeeKas);
  const feeDiffKas = hasFeePair ? Number(Math.abs(chainFeeKas - backendFeeKas).toFixed(8)) : undefined;
  if (typeof feeDiffKas === "number" && feeDiffKas > Math.max(0, n(tolerances?.feeKasTolerance, 0))) {
    mismatches.push("fee_kas");
  }

  const backendSlippageKas = n(item?.backend_receipt_slippage_kas ?? item?.receipt_slippage_kas, NaN);
  const chainDerivedSlippageKas = n(item?.chain_derived_slippage_kas, NaN);
  const fallbackDerived = Number.isFinite(chainDerivedSlippageKas) ? chainDerivedSlippageKas : deriveChainSlippageKas(item);
  const hasSlippagePair = Number.isFinite(backendSlippageKas) && Number.isFinite(fallbackDerived);
  const slippageDiffKas = hasSlippagePair ? Number(Math.abs(backendSlippageKas - Number(fallbackDerived)).toFixed(8)) : undefined;
  if (typeof slippageDiffKas === "number" && slippageDiffKas > Math.max(0, n(tolerances?.slippageKasTolerance, 0))) {
    mismatches.push("slippage_kas");
  }

  const comparable =
    hasConfirmTsPair ||
    hasFeePair ||
    hasSlippagePair;
  const status: ReceiptConsistencyStatus = !comparable ? "insufficient" : mismatches.length > 0 ? "mismatch" : "consistent";

  return {
    status,
    mismatches,
    ...(typeof confirmTsDriftMs === "number" ? { confirmTsDriftMs } : {}),
    ...(typeof feeDiffKas === "number" ? { feeDiffKas } : {}),
    ...(typeof slippageDiffKas === "number" ? { slippageDiffKas } : {}),
    checkedTs,
  };
}

