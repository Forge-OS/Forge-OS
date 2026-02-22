import { describe, expect, it } from "vitest";
import { deriveReceiptConsistency } from "../../src/runtime/receiptConsistency";

describe("receiptConsistency", () => {
  const tol = { confirmTsDriftMs: 5000, feeKasTolerance: 0.00005, slippageKasTolerance: 0.002 };

  it("returns consistent when backend and chain telemetry match within tolerance", () => {
    const out = deriveReceiptConsistency(
      {
        amount_kas: 10,
        broadcast_price_usd: 0.1,
        confirm_price_usd: 0.101,
        chain_confirm_ts: 1_000_000,
        backend_confirm_ts: 1_003_000,
        chain_receipt_fee_kas: 0.00012,
        backend_receipt_fee_kas: 0.00013,
        backend_receipt_slippage_kas: 0.1,
        chain_derived_slippage_kas: 0.101,
      },
      tol
    );
    expect(out.status).toBe("consistent");
    expect(out.mismatches).toHaveLength(0);
  });

  it("flags mismatch categories that exceed tolerance", () => {
    const out = deriveReceiptConsistency(
      {
        amount_kas: 10,
        broadcast_price_usd: 0.1,
        confirm_price_usd: 0.105,
        chain_confirm_ts: 1_000_000,
        backend_confirm_ts: 1_020_000,
        chain_receipt_fee_kas: 0.0001,
        backend_receipt_fee_kas: 0.001,
        backend_receipt_slippage_kas: 0.001,
        chain_derived_slippage_kas: 0.01,
      },
      tol
    );
    expect(out.status).toBe("mismatch");
    expect(out.mismatches).toContain("confirm_ts");
    expect(out.mismatches).toContain("fee_kas");
    expect(out.mismatches).toContain("slippage_kas");
  });

  it("returns insufficient when only one source exists", () => {
    const out = deriveReceiptConsistency(
      {
        chain_confirm_ts: 1_000_000,
        chain_receipt_fee_kas: 0.0001,
      },
      tol
    );
    expect(out.status).toBe("insufficient");
  });
});

