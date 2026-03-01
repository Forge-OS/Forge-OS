import { buildQuantCoreDecision, type QuantSnapshot } from "../quant/quantCore";
import { clamp, maxDrawdownPct, mean, stddev } from "../quant/math";

export type BacktestTrade = {
  ts: number;
  side: "buy" | "sell";
  qtyKas: number;
  priceUsd: number;
  notionalUsd: number;
  feeUsd: number;
  action: string;
  regime: string;
  confidence: number;
  realizedPnlUsd?: number;
};

export type BacktestEquityPoint = {
  ts: number;
  equityUsd: number;
  cashUsd: number;
  positionKas: number;
};

export type QuantBacktestConfig = {
  agent: any;
  snapshots: QuantSnapshot[];
  initialCashUsd?: number;
  feeBps?: number;
  slippageBps?: number;
  warmupSamples?: number;
  maxLookback?: number;
};

export type QuantBacktestResult = {
  initialCashUsd: number;
  finalEquityUsd: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  winRatePct: number;
  profitFactor: number;
  totalTrades: number;
  closedTrades: number;
  avgWinUsd: number;
  avgLossUsd: number;
  trades: BacktestTrade[];
  equityCurve: BacktestEquityPoint[];
};

const n = (value: any, fallback = 0) => {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
};

function normalizeSnapshots(raw: QuantSnapshot[]) {
  const rows = Array.isArray(raw) ? [...raw] : [];
  rows.sort((a, b) => n(a?.ts, 0) - n(b?.ts, 0));
  return rows.filter((row) => n(row?.ts, 0) > 0 && n(row?.priceUsd, 0) > 0);
}

function deriveSharpeRatio(equityCurve: BacktestEquityPoint[]) {
  if (equityCurve.length < 3) return 0;
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i += 1) {
    const prev = n(equityCurve[i - 1]?.equityUsd, 0);
    const next = n(equityCurve[i]?.equityUsd, 0);
    if (prev > 0 && next > 0) {
      returns.push((next - prev) / prev);
    }
  }
  if (returns.length < 2) return 0;
  const avgReturn = mean(returns);
  const sigma = stddev(returns);
  if (sigma <= 0) return 0;

  const deltasSec: number[] = [];
  for (let i = 1; i < equityCurve.length; i += 1) {
    const dt = (n(equityCurve[i]?.ts, 0) - n(equityCurve[i - 1]?.ts, 0)) / 1000;
    if (dt > 0) deltasSec.push(dt);
  }
  const avgStepSec = deltasSec.length ? mean(deltasSec) : 60;
  const periodsPerYear = Math.max(1, (365 * 24 * 60 * 60) / Math.max(1, avgStepSec));
  return (avgReturn / sigma) * Math.sqrt(periodsPerYear);
}

export function runQuantBacktest(config: QuantBacktestConfig): QuantBacktestResult {
  const snapshots = normalizeSnapshots(config.snapshots);
  if (snapshots.length < 12) {
    throw new Error("BACKTEST_DATA_INSUFFICIENT: expected at least 12 snapshots.");
  }

  const initialCashUsd = Math.max(1, n(config.initialCashUsd, 10_000));
  const feeRate = clamp(n(config.feeBps, 8) / 10_000, 0, 0.05);
  const slippageRate = clamp(n(config.slippageBps, 6) / 10_000, 0, 0.05);
  const warmupSamples = Math.max(6, Math.round(n(config.warmupSamples, 24)));
  const maxLookback = Math.max(warmupSamples, Math.round(n(config.maxLookback, 240)));

  let cashUsd = initialCashUsd;
  let positionKas = 0;
  let positionCostUsd = 0;
  const trades: BacktestTrade[] = [];
  const closedPnls: number[] = [];
  const equityCurve: BacktestEquityPoint[] = [];

  for (let i = warmupSamples; i < snapshots.length; i += 1) {
    const current = snapshots[i];
    const priceUsd = n(current?.priceUsd, 0);
    if (!(priceUsd > 0)) continue;

    const historyStart = Math.max(0, i - maxLookback);
    const history = snapshots.slice(historyStart, i);
    const decision = buildQuantCoreDecision(config.agent, current, {
      history,
      now: n(current?.ts, Date.now()),
    });
    const action = String(decision?.action || "HOLD").toUpperCase();
    const regime = String(decision?.quant_metrics?.regime || "NEUTRAL");
    const confidence = clamp(n(decision?.confidence_score, 0), 0, 1);
    const requestedKas = Math.max(0, n(decision?.capital_allocation_kas, 0));

    if (action === "ACCUMULATE" && requestedKas > 0) {
      const buyPrice = priceUsd * (1 + slippageRate);
      const affordableKas = buyPrice > 0 ? cashUsd / (buyPrice * (1 + feeRate)) : 0;
      const qtyKas = Math.max(0, Math.min(requestedKas, affordableKas));
      if (qtyKas > 0) {
        const notionalUsd = qtyKas * buyPrice;
        const feeUsd = notionalUsd * feeRate;
        const totalCostUsd = notionalUsd + feeUsd;
        cashUsd = Math.max(0, cashUsd - totalCostUsd);
        positionKas += qtyKas;
        positionCostUsd += totalCostUsd;
        trades.push({
          ts: n(current?.ts, Date.now()),
          side: "buy",
          qtyKas: Number(qtyKas.toFixed(8)),
          priceUsd: Number(buyPrice.toFixed(8)),
          notionalUsd: Number(notionalUsd.toFixed(8)),
          feeUsd: Number(feeUsd.toFixed(8)),
          action,
          regime,
          confidence: Number(confidence.toFixed(4)),
        });
      }
    } else if (action === "REDUCE" && positionKas > 0) {
      const sellPrice = priceUsd * (1 - slippageRate);
      const qtyKas = Math.max(0, Math.min(positionKas, requestedKas > 0 ? requestedKas : positionKas * 0.25));
      if (qtyKas > 0) {
        const notionalUsd = qtyKas * sellPrice;
        const feeUsd = notionalUsd * feeRate;
        const proceedsUsd = Math.max(0, notionalUsd - feeUsd);
        const positionKasBefore = Math.max(positionKas, 0.00000001);
        const realizedCostBasisUsd = positionCostUsd * (qtyKas / positionKasBefore);
        const realizedPnlUsd = proceedsUsd - realizedCostBasisUsd;
        cashUsd += proceedsUsd;
        positionKas = Math.max(0, positionKas - qtyKas);
        positionCostUsd = Math.max(0, positionCostUsd - realizedCostBasisUsd);
        closedPnls.push(realizedPnlUsd);
        trades.push({
          ts: n(current?.ts, Date.now()),
          side: "sell",
          qtyKas: Number(qtyKas.toFixed(8)),
          priceUsd: Number(sellPrice.toFixed(8)),
          notionalUsd: Number(notionalUsd.toFixed(8)),
          feeUsd: Number(feeUsd.toFixed(8)),
          action,
          regime,
          confidence: Number(confidence.toFixed(4)),
          realizedPnlUsd: Number(realizedPnlUsd.toFixed(8)),
        });
      }
    }

    equityCurve.push({
      ts: n(current?.ts, Date.now()),
      equityUsd: Number((cashUsd + positionKas * priceUsd).toFixed(8)),
      cashUsd: Number(cashUsd.toFixed(8)),
      positionKas: Number(positionKas.toFixed(8)),
    });
  }

  const lastPrice = n(snapshots[snapshots.length - 1]?.priceUsd, 0);
  const finalEquityUsd = Number((cashUsd + positionKas * lastPrice).toFixed(8));
  const totalReturnPct = ((finalEquityUsd - initialCashUsd) / initialCashUsd) * 100;
  const wins = closedPnls.filter((p) => p > 0);
  const losses = closedPnls.filter((p) => p < 0);
  const winRatePct = closedPnls.length > 0 ? (wins.length / closedPnls.length) * 100 : 0;
  const grossProfit = wins.reduce((sum, p) => sum + p, 0);
  const grossLossAbs = Math.abs(losses.reduce((sum, p) => sum + p, 0));
  const profitFactor = grossLossAbs > 0 ? grossProfit / grossLossAbs : (grossProfit > 0 ? 999 : 0);
  const maxDrawdown = maxDrawdownPct(equityCurve.map((p) => n(p.equityUsd, 0))) * 100;

  return {
    initialCashUsd: Number(initialCashUsd.toFixed(2)),
    finalEquityUsd: Number(finalEquityUsd.toFixed(2)),
    totalReturnPct: Number(totalReturnPct.toFixed(4)),
    maxDrawdownPct: Number(maxDrawdown.toFixed(4)),
    sharpeRatio: Number(deriveSharpeRatio(equityCurve).toFixed(4)),
    winRatePct: Number(winRatePct.toFixed(2)),
    profitFactor: Number(profitFactor.toFixed(4)),
    totalTrades: trades.length,
    closedTrades: closedPnls.length,
    avgWinUsd: Number((wins.length ? mean(wins) : 0).toFixed(6)),
    avgLossUsd: Number((losses.length ? mean(losses) : 0).toFixed(6)),
    trades,
    equityCurve,
  };
}

