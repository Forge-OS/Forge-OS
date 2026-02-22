import { describe, expect, it } from 'vitest';
import { derivePnlAttribution } from '../../src/analytics/pnlAttribution';

describe('pnlAttribution', () => {
  it('uses realized mode when all executed signals have chain-timestamp receipt telemetry', () => {
    const summary = derivePnlAttribution({
      decisions: [
        {
          ts: 1_000,
          dec: {
            action: 'ACCUMULATE',
            capital_allocation_kas: 10,
            expected_value_pct: 2,
            confidence_score: 0.8,
            liquidity_impact: 'MODERATE',
            decision_source: 'hybrid-ai',
            quant_metrics: { win_probability_model: 0.6, regime: 'TREND_UP' },
          },
        },
      ],
      queue: [
        {
          id: 'q1',
          type: 'ACCUMULATE',
          status: 'signed',
          metaKind: 'action',
          amount_kas: 10,
          receipt_lifecycle: 'confirmed',
          confirmations: 2,
          receipt_fee_kas: 0.0001,
          broadcast_price_usd: 0.10,
          confirm_price_usd: 0.101,
          broadcast_ts: 1_000,
          confirm_ts: 3_000,
          confirm_ts_source: 'chain',
          dec: { liquidity_impact: 'MODERATE', action: 'ACCUMULATE' },
        },
      ],
      log: [],
      marketHistory: [
        { ts: 1_000, priceUsd: 0.10 },
        { ts: 2_000, priceUsd: 0.102 },
        { ts: 3_000, priceUsd: 0.103 },
      ],
    });

    expect(summary.netPnlMode).toBe('realized');
    expect(summary.confirmedSignals).toBe(1);
    expect(summary.executedSignals).toBe(1);
    expect(summary.receiptCoveragePct).toBe(100);
    expect(summary.realizedReceiptCoveragePct).toBe(100);
    expect(summary.chainFeeCoveragePct).toBe(100);
    expect(summary.provenanceChainSignals).toBe(1);
    expect(summary.provenanceBackendSignals).toBe(0);
    expect(summary.provenanceEstimatedSignals).toBe(0);
    expect(summary.realizedChainFeeKas).toBeCloseTo(0.0001, 8);
    expect(summary.realizedExecutionDriftKas).toBeGreaterThan(0);
    expect(summary.netPnlKas).not.toBe(summary.estimatedNetPnlKas);
    expect(summary.confidenceBrierScore).toBeGreaterThanOrEqual(0);
    expect(summary.evCalibrationErrorPct).toBeGreaterThanOrEqual(0);
    expect(summary.regimeHitSamples).toBeGreaterThanOrEqual(0);
  });

  it('prefers backend receipt slippage telemetry when present', () => {
    const summary = derivePnlAttribution({
      decisions: [
        {
          ts: 1_000,
          dec: {
            action: 'ACCUMULATE',
            capital_allocation_kas: 10,
            expected_value_pct: 2,
            confidence_score: 0.8,
            liquidity_impact: 'MODERATE',
            decision_source: 'hybrid-ai',
          },
        },
      ],
      queue: [
        {
          id: 'q2',
          type: 'ACCUMULATE',
          status: 'signed',
          metaKind: 'action',
          amount_kas: 10,
          receipt_lifecycle: 'confirmed',
          confirmations: 2,
          receipt_fee_kas: 0.0001,
          receipt_slippage_kas: 0.0025,
          receipt_imported_from: 'callback_consumer',
          receipt_source_path: 'callback-consumer:/v1/execution-receipts',
          confirm_ts: 3_000,
          confirm_ts_source: 'chain',
          dec: { liquidity_impact: 'MODERATE', action: 'ACCUMULATE' },
        },
      ],
      log: [],
      marketHistory: [],
    });

    expect(summary.netPnlMode).toBe('realized');
    expect(summary.realizedExecutionDriftKas).toBeCloseTo(0.0025, 8);
    expect(summary.realizedReceiptCoveragePct).toBe(100);
    expect(summary.provenanceBackendSignals).toBe(1);
    expect(summary.provenanceChainSignals).toBe(0);
    expect(summary.provenanceEstimatedSignals).toBe(0);
  });

  it('applies tiered confirmation policy by action, risk, and amount before counting realized coverage', () => {
    const summary = derivePnlAttribution({
      decisions: [],
      queue: [
        {
          id: 'q3',
          type: 'REDUCE',
          status: 'signed',
          metaKind: 'action',
          amount_kas: 50,
          receipt_lifecycle: 'confirmed',
          confirmations: 2,
          receipt_fee_kas: 0.0002,
          broadcast_ts: 1_000,
          confirm_ts: 2_000,
          confirm_ts_source: 'chain',
          dec: {
            action: 'REDUCE',
            expected_value_pct: 1.4,
            liquidity_impact: 'SIGNIFICANT',
            risk_score: 0.82,
            quant_metrics: { regime: 'TREND_DOWN' },
          },
        },
      ],
      log: [],
      marketHistory: [
        { ts: 1_000, priceUsd: 0.12 },
        { ts: 2_000, priceUsd: 0.118 },
      ],
      realizedMinConfirmations: 1,
      confirmationDepthPolicy: {
        base: 1,
        byAction: { REDUCE: 2 },
        byRisk: { HIGH: 3 },
        amountTiersKas: [{ minAmountKas: 25, minConfirmations: 4 }],
      },
    });

    expect(summary.netPnlMode).toBe('hybrid');
    expect(summary.confirmedSignals).toBe(1);
    expect(summary.realizedReceiptCoveragePct).toBe(0);
    expect(summary.chainFeeCoveragePct).toBe(0);
    expect(summary.confirmationFloorObservedMin).toBe(4);
    expect(summary.confirmationFloorObservedMax).toBe(4);
  });
});
