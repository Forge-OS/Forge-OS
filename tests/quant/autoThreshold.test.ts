import { describe, expect, it } from "vitest";
import {
  computeRollingWinRate,
  deriveAdaptiveAutoApproveThreshold,
} from "../../src/quant/autoThreshold";

function buildHistory(startPrice: number, stepPct: number, points: number) {
  const out: Array<{ ts: number; priceUsd: number }> = [];
  let price = startPrice;
  const startTs = 1_710_000_000_000;
  for (let i = 0; i < points; i += 1) {
    out.push({ ts: startTs + i * 60_000, priceUsd: Number(price.toFixed(8)) });
    price *= 1 + stepPct / 100;
  }
  return out;
}

function decisionsFrom(history: Array<{ ts: number }>, action: "ACCUMULATE" | "REDUCE", every = 4) {
  return history
    .filter((_, i) => i % every === 0)
    .map((h) => ({ ts: h.ts, dec: { action } }));
}

describe("auto threshold calibration", () => {
  it("boosts threshold when rolling win rate is strong", () => {
    const history = buildHistory(0.1, 0.3, 120); // persistent uptrend
    const decisions = decisionsFrom(history, "ACCUMULATE", 5);
    const out = deriveAdaptiveAutoApproveThreshold({
      baseThresholdKas: 40,
      decisions,
      marketHistory: history,
      calibrationHealth: 0.95,
      minimumSamples: 8,
    });
    expect(out.samplesSufficient).toBe(true);
    expect(out.rolling.winRatePct).toBeGreaterThan(60);
    expect(out.multiplier).toBeGreaterThan(1);
    expect(out.thresholdKas).toBeGreaterThan(40);
  });

  it("tightens threshold when rolling win rate is weak", () => {
    const history = buildHistory(0.1, 0.28, 120); // uptrend punishes REDUCE calls
    const decisions = decisionsFrom(history, "REDUCE", 5);
    const out = deriveAdaptiveAutoApproveThreshold({
      baseThresholdKas: 40,
      decisions,
      marketHistory: history,
      calibrationHealth: 0.75,
      minimumSamples: 8,
    });
    expect(out.samplesSufficient).toBe(true);
    expect(out.rolling.winRatePct).toBeLessThan(40);
    expect(out.multiplier).toBeLessThan(1);
    expect(out.thresholdKas).toBeLessThan(40);
  });

  it("falls back to baseline when samples are insufficient", () => {
    const history = buildHistory(0.1, 0.1, 20);
    const decisions = decisionsFrom(history, "ACCUMULATE", 10);
    const rolling = computeRollingWinRate({
      decisions,
      marketHistory: history,
      maxSamples: 8,
    });
    expect(rolling.samples).toBeLessThan(8);

    const out = deriveAdaptiveAutoApproveThreshold({
      baseThresholdKas: 25,
      decisions,
      marketHistory: history,
      minimumSamples: 8,
    });
    expect(out.samplesSufficient).toBe(false);
    expect(out.multiplier).toBe(1);
    expect(out.thresholdKas).toBe(25);
  });
});

