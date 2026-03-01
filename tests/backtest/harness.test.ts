import { describe, expect, it } from "vitest";
import { runQuantBacktest } from "../../src/backtest/harness";

function sampleSnapshots(count: number) {
  const out: any[] = [];
  const startTs = 1_710_000_000_000;
  let price = 0.11;
  let daa = 3_000_000;
  for (let i = 0; i < count; i += 1) {
    const drift = i < count / 2 ? 1.0012 : 0.9991;
    const noise = 1 + Math.sin(i / 14) * 0.0022;
    price = Math.max(0.02, price * drift * noise);
    daa += 9 + (i % 3);
    out.push({
      ts: startTs + i * 60_000,
      priceUsd: Number(price.toFixed(8)),
      daaScore: daa,
      walletKas: 5000,
    });
  }
  return out;
}

describe("quant backtest harness", () => {
  it("runs end-to-end and returns stable metrics", () => {
    const snapshots = sampleSnapshots(420);
    const result = runQuantBacktest({
      agent: {
        risk: "medium",
        strategyTemplate: "trend",
        capitalLimit: 180,
      },
      snapshots,
      initialCashUsd: 5000,
      feeBps: 10,
      slippageBps: 8,
      warmupSamples: 36,
      maxLookback: 240,
    });

    expect(result.totalTrades).toBeGreaterThan(0);
    expect(result.equityCurve.length).toBeGreaterThan(100);
    expect(result.finalEquityUsd).toBeGreaterThan(0);
    expect(result.maxDrawdownPct).toBeGreaterThanOrEqual(0);
    expect(result.maxDrawdownPct).toBeLessThanOrEqual(100);
    expect(Number.isFinite(result.sharpeRatio)).toBe(true);
  });

  it("throws on insufficient data", () => {
    expect(() =>
      runQuantBacktest({
        agent: { risk: "low", strategyTemplate: "dca_accumulator", capitalLimit: 40 },
        snapshots: sampleSnapshots(8),
      }),
    ).toThrow(/BACKTEST_DATA_INSUFFICIENT/);
  });
});

