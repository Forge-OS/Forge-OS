import { describe, expect, it } from "vitest";
import { derivePnlAttribution } from "../../src/analytics/pnlAttribution";

const SLO_MAX_BRIER = Number(process.env.CALIBRATION_SLO_MAX_BRIER || 0.12);
const SLO_MAX_EV_CAL_ERROR_PCT = Number(process.env.CALIBRATION_SLO_MAX_EV_CAL_ERROR_PCT || 0.75);
const SLO_MIN_REGIME_HIT_RATE_PCT = Number(process.env.CALIBRATION_SLO_MIN_REGIME_HIT_RATE_PCT || 80);
const SLO_MIN_REGIME_HIT_SAMPLES = Number(process.env.CALIBRATION_SLO_MIN_REGIME_HIT_SAMPLES || 8);

describe("pnl calibration replay SLOs", () => {
  it("meets replay-based calibration thresholds for confidence, EV calibration, and regime hit rate", () => {
    const fixture = buildCalibrationReplayFixture();
    const summary = derivePnlAttribution({
      decisions: fixture.decisions,
      queue: fixture.queue,
      log: fixture.log,
      marketHistory: fixture.marketHistory,
      realizedMinConfirmations: 1,
      confirmationDepthPolicy: { base: 1, byRisk: { HIGH: 2 } },
    });

    expect(summary.executedSignals).toBe(fixture.queue.length);
    expect(summary.realizedReceiptCoveragePct).toBe(100);
    expect(summary.confidenceBrierScore).toBeLessThanOrEqual(SLO_MAX_BRIER);
    expect(summary.evCalibrationErrorPct).toBeLessThanOrEqual(SLO_MAX_EV_CAL_ERROR_PCT);
    expect(summary.regimeHitSamples).toBeGreaterThanOrEqual(SLO_MIN_REGIME_HIT_SAMPLES);
    expect(summary.regimeHitRatePct).toBeGreaterThanOrEqual(SLO_MIN_REGIME_HIT_RATE_PCT);
  });
});

function buildCalibrationReplayFixture() {
  const decisions: any[] = [];
  const queue: any[] = [];
  const marketHistory: any[] = [];
  const log: any[] = [];

  let ts = 1_710_000_000_000;
  let price = 0.12;
  const patterns = [
    { action: "ACCUMULATE", regime: "TREND_UP", movePct: 1.2, conf: 0.84, evPct: 1.1, amountKas: 10, riskScore: 0.32 },
    { action: "ACCUMULATE", regime: "TREND_UP", movePct: 0.9, conf: 0.79, evPct: 0.85, amountKas: 12, riskScore: 0.36 },
    { action: "REDUCE", regime: "TREND_DOWN", movePct: -1.0, conf: 0.77, evPct: 0.95, amountKas: 9, riskScore: 0.45 },
    { action: "ACCUMULATE", regime: "TREND_UP", movePct: 1.4, conf: 0.87, evPct: 1.25, amountKas: 14, riskScore: 0.33 },
    { action: "REDUCE", regime: "TREND_DOWN", movePct: -0.8, conf: 0.75, evPct: 0.7, amountKas: 11, riskScore: 0.41 },
    { action: "ACCUMULATE", regime: "TREND_UP", movePct: 1.1, conf: 0.82, evPct: 1.0, amountKas: 13, riskScore: 0.34 },
    { action: "REDUCE", regime: "TREND_DOWN", movePct: -1.3, conf: 0.81, evPct: 1.15, amountKas: 8, riskScore: 0.48 },
    { action: "ACCUMULATE", regime: "TREND_UP", movePct: 0.95, conf: 0.8, evPct: 0.9, amountKas: 10.5, riskScore: 0.37 },
    { action: "ACCUMULATE", regime: "RANGE_VOL", movePct: 1.0, conf: 0.73, evPct: 0.9, amountKas: 7.5, riskScore: 0.52 },
    { action: "REDUCE", regime: "RANGE_VOL", movePct: -0.9, conf: 0.72, evPct: 0.82, amountKas: 7.8, riskScore: 0.55 },
  ];

  patterns.forEach((p, i) => {
    const t0 = ts + i * 10_000;
    const t1 = t0 + 100;
    const t2 = t0 + 200;
    const t3 = t0 + 300;
    const priceStart = price;
    const priceEnd = Number((priceStart * (1 + p.movePct / 100)).toFixed(6));
    const priceMid1 = Number((priceStart + (priceEnd - priceStart) * 0.33).toFixed(6));
    const priceMid2 = Number((priceStart + (priceEnd - priceStart) * 0.66).toFixed(6));

    marketHistory.push(
      { ts: t0, priceUsd: priceStart },
      { ts: t1, priceUsd: priceMid1 },
      { ts: t2, priceUsd: priceMid2 },
      { ts: t3, priceUsd: priceEnd }
    );

    decisions.push({
      ts: t0,
      dec: {
        action: p.action,
        capital_allocation_kas: p.amountKas,
        expected_value_pct: p.evPct,
        confidence_score: p.conf,
        liquidity_impact: i % 3 === 0 ? "MODERATE" : "SIGNIFICANT",
        decision_source: "hybrid-ai",
        quant_metrics: {
          regime: p.regime,
          win_probability_model: Math.min(0.95, Math.max(0.55, p.conf - 0.02)),
        },
      },
    });

    queue.push({
      id: `replay-${i + 1}`,
      ts: t0 + 20,
      type: p.action,
      status: "signed",
      metaKind: "action",
      amount_kas: p.amountKas,
      receipt_lifecycle: "confirmed",
      confirmations: p.riskScore >= 0.5 ? 2 : 1,
      receipt_fee_kas: 0.0001 + (i % 3) * 0.00001,
      broadcast_price_usd: priceStart,
      confirm_price_usd: priceEnd,
      broadcast_ts: t0,
      confirm_ts: t3,
      confirm_ts_source: "chain",
      dec: {
        action: p.action,
        expected_value_pct: p.evPct,
        liquidity_impact: i % 3 === 0 ? "MODERATE" : "SIGNIFICANT",
        risk_score: p.riskScore,
        quant_metrics: {
          regime: p.regime,
          risk_profile: p.riskScore >= 0.5 ? "HIGH" : p.riskScore >= 0.4 ? "MEDIUM" : "LOW",
        },
      },
    });

    log.push({
      ts: t0 + 25,
      type: "EXEC",
      msg: `${p.action} replay fill`,
      fee: 0.0002,
    });

    price = Number((priceEnd * (1 + (i % 2 === 0 ? 0.0015 : -0.0012))).toFixed(6));
  });

  marketHistory.sort((a, b) => a.ts - b.ts);
  return { decisions, queue, marketHistory, log };
}

