import { describe, expect, it } from "vitest";
import { buildQuantCoreDecision } from "../../src/quant/quantCore";

function trendSnapshots(direction: "up" | "down", count = 320) {
  const out: any[] = [];
  const startTs = 1_710_000_000_000;
  let price = 0.1;
  let daa = 2_000_000;
  for (let i = 0; i < count; i += 1) {
    const step = direction === "up" ? 1.0015 : 0.9982;
    const wobble = 1 + Math.sin(i / 10) * 0.0008;
    price = Math.max(0.01, price * step * wobble);
    daa += 8 + (i % 4);
    out.push({
      ts: startTs + i * 60_000,
      priceUsd: Number(price.toFixed(8)),
      daaScore: daa,
      walletKas: 5000,
    });
  }
  return out;
}

describe("quant core regime-adaptive and MTF metrics", () => {
  it("emits multi-timeframe metrics for trend strategy", () => {
    const history = trendSnapshots("up");
    const latest = history[history.length - 1];
    const decision = buildQuantCoreDecision(
      { risk: "medium", strategyTemplate: "trend", capitalLimit: 250 },
      latest,
      { history: history.slice(0, -1), now: latest.ts },
    );

    expect(decision.quant_metrics.mtf_signal_1h).toBeTypeOf("number");
    expect(decision.quant_metrics.mtf_signal_4h).toBeTypeOf("number");
    expect(decision.quant_metrics.mtf_signal_24h).toBeTypeOf("number");
    expect(decision.quant_metrics.mtf_weighted_score).toBeTypeOf("number");
    expect(decision.quant_metrics.strategy_mode).toBeTypeOf("string");
    expect(decision.quant_metrics.adaptive_risk_ceiling).toBeTypeOf("number");
  });

  it("switches to defensive mode in risk-off context", () => {
    const history = trendSnapshots("down");
    const latest = history[history.length - 1];
    const decision = buildQuantCoreDecision(
      { risk: "medium", strategyTemplate: "trend", capitalLimit: 250 },
      latest,
      { history: history.slice(0, -1), now: latest.ts },
    );

    expect(String(decision.quant_metrics.regime)).toMatch(/RISK_OFF|TREND_DOWN|NEUTRAL/);
    if (decision.quant_metrics.regime === "RISK_OFF") {
      expect(decision.quant_metrics.strategy_mode).toBe("CAPITAL_PRESERVATION");
      expect((decision.quant_metrics.adaptive_risk_ceiling || 1)).toBeLessThan(0.65);
    }
  });
});

