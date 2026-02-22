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
            quant_metrics: { win_probability_model: 0.6 },
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
    expect(summary.realizedChainFeeKas).toBeCloseTo(0.0001, 8);
    expect(summary.realizedExecutionDriftKas).toBeGreaterThan(0);
    expect(summary.netPnlKas).not.toBe(summary.estimatedNetPnlKas);
  });
});
