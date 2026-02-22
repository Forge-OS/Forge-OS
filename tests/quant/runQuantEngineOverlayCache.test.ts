import { describe, expect, it } from "vitest";
import {
  agentOverlayCacheKey,
  createOverlayDecisionCache,
  decisionSignature,
} from "../../src/quant/runQuantEngineOverlayCache";

describe("runQuantEngineOverlayCache", () => {
  it("separates cache keys by strategy template and execution mode", () => {
    const kasData = { address: "kaspa:qabc", dag: { networkName: "kaspa-mainnet" } };
    const baseAgent = {
      agentId: "agent-1",
      risk: "medium",
      capitalLimit: 10,
      kpiTarget: 8,
      horizon: 24,
      autoApproveThreshold: 1,
    };
    const dcaNotify = agentOverlayCacheKey(
      { ...baseAgent, strategyTemplate: "dca_accumulator", execMode: "notify_only" },
      kasData
    );
    const trendNotify = agentOverlayCacheKey(
      { ...baseAgent, strategyTemplate: "trend_follow", execMode: "notify_only" },
      kasData
    );
    const dcaAutonomous = agentOverlayCacheKey(
      { ...baseAgent, strategyTemplate: "dca_accumulator", execMode: "autonomous" },
      kasData
    );

    expect(dcaNotify).not.toBe(trendNotify);
    expect(dcaNotify).not.toBe(dcaAutonomous);
  });

  it("bounds cache entries and evicts oldest", () => {
    const cache = createOverlayDecisionCache(2);
    cache.set("a", "sig-a", { action: "HOLD" });
    cache.set("b", "sig-b", { action: "ACCUMULATE" });
    cache.set("c", "sig-c", { action: "REDUCE" });

    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")?.signature).toBe("sig-b");
    expect(cache.get("c")?.signature).toBe("sig-c");
  });

  it("builds stable decision signatures from quant buckets", () => {
    const sig1 = decisionSignature({
      action: "ACCUMULATE",
      confidence_score: 0.811,
      risk_score: 0.41,
      kelly_fraction: 0.12,
      volatility_estimate: "MEDIUM",
      quant_metrics: {
        regime: "TREND_UP",
        edge_score: 0.44,
        data_quality_score: 0.81,
        sample_count: 42,
      },
    });
    const sig2 = decisionSignature({
      action: "ACCUMULATE",
      confidence_score: 0.814,
      risk_score: 0.413,
      kelly_fraction: 0.121,
      volatility_estimate: "MEDIUM",
      quant_metrics: {
        regime: "TREND_UP",
        edge_score: 0.441,
        data_quality_score: 0.808,
        sample_count: 42.2,
      },
    });

    expect(sig1).toBe(sig2);
  });
});
