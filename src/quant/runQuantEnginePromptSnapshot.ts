import { round, toFinite } from "./math";

export function buildQuantFeatureSnapshot(agent: any, kasData: any, quantCoreDecision: any) {
  const qm = quantCoreDecision?.quant_metrics || {};
  return {
    agent: {
      id: String(agent?.agentId || agent?.name || "agent"),
      risk: String(agent?.risk || ""),
      capitalLimit: round(Math.max(0, toFinite(agent?.capitalLimit, 0)), 6),
      autoApproveThreshold: round(Math.max(0, toFinite(agent?.autoApproveThreshold, 0)), 6),
      strategyTemplate: String(agent?.strategyTemplate || agent?.strategyLabel || "custom"),
    },
    kaspa: {
      address: String(kasData?.address || ""),
      walletKas: round(Math.max(0, toFinite(kasData?.walletKas, 0)), 6),
      priceUsd: round(Math.max(0, toFinite(kasData?.priceUsd, 0)), 8),
      daaScore: Math.max(0, Math.round(toFinite(kasData?.dag?.daaScore, 0))),
      network: String(kasData?.dag?.networkName || kasData?.dag?.network || ""),
    },
    quantCore: {
      action: String(quantCoreDecision?.action || "HOLD"),
      confidence_score: round(toFinite(quantCoreDecision?.confidence_score, 0), 4),
      risk_score: round(toFinite(quantCoreDecision?.risk_score, 0), 4),
      kelly_fraction: round(toFinite(quantCoreDecision?.kelly_fraction, 0), 6),
      capital_allocation_kas: round(toFinite(quantCoreDecision?.capital_allocation_kas, 0), 6),
      expected_value_pct: round(toFinite(quantCoreDecision?.expected_value_pct, 0), 4),
      quant_metrics: {
        regime: String(qm?.regime || ""),
        sample_count: Math.max(0, Math.round(toFinite(qm?.sample_count, 0))),
        edge_score: round(toFinite(qm?.edge_score, 0), 6),
        data_quality_score: round(toFinite(qm?.data_quality_score, 0), 6),
        ewma_volatility: round(toFinite(qm?.ewma_volatility, 0), 6),
        risk_ceiling: round(toFinite(qm?.risk_ceiling, 0), 6),
        kelly_cap: round(toFinite(qm?.kelly_cap, 0), 6),
      },
    },
  };
}

export function buildQuantFeatureSnapshotExcerpt(kasData: any, quantCoreDecision: any) {
  return {
    regime: String(quantCoreDecision?.quant_metrics?.regime || ""),
    sample_count: Math.max(0, Math.round(toFinite(quantCoreDecision?.quant_metrics?.sample_count, 0))),
    edge_score: round(toFinite(quantCoreDecision?.quant_metrics?.edge_score, 0), 6),
    data_quality_score: round(toFinite(quantCoreDecision?.quant_metrics?.data_quality_score, 0), 6),
    price_usd: round(toFinite(kasData?.priceUsd, 0), 8),
    wallet_kas: round(toFinite(kasData?.walletKas, 0), 6),
    daa_score: Math.max(0, Math.round(toFinite(kasData?.dag?.daaScore, 0))),
  };
}

