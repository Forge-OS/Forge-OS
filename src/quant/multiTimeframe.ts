import { clamp, linearSlope, round, stddev, toFinite } from "./math";
import type { QuantSnapshot } from "./quantCore";

export type TimeframeKey = "1h" | "4h" | "24h";

export type TimeframeCandle = {
  timeframe: TimeframeKey;
  startTs: number;
  endTs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  samples: number;
  coverage: number;
};

export type TimeframeSignal = {
  candle: TimeframeCandle;
  returnPct: number;
  slopePct: number;
  volatilityPct: number;
  score: number;
};

export type MultiTimeframeSignals = {
  signals: Record<TimeframeKey, TimeframeSignal>;
  weightedScore: number;
  alignment: number;
  coverage: number;
  dominantTimeframe: TimeframeKey;
};

const TIMEFRAME_MS: Record<TimeframeKey, number> = {
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

const TIMEFRAME_WEIGHTS: Record<TimeframeKey, number> = {
  "1h": 0.45,
  "4h": 0.35,
  "24h": 0.2,
};

function neutralSignal(timeframe: TimeframeKey, now: number): TimeframeSignal {
  return {
    candle: {
      timeframe,
      startTs: now,
      endTs: now,
      open: 0,
      high: 0,
      low: 0,
      close: 0,
      samples: 0,
      coverage: 0,
    },
    returnPct: 0,
    slopePct: 0,
    volatilityPct: 0,
    score: 0,
  };
}

function signalForTimeframe(
  timeframe: TimeframeKey,
  snapshots: QuantSnapshot[],
  now: number,
): TimeframeSignal {
  const spanMs = TIMEFRAME_MS[timeframe];
  const sinceTs = now - spanMs;
  const points = snapshots.filter((row) => row.ts >= sinceTs && row.ts <= now && row.priceUsd > 0);
  if (points.length < 2) {
    return neutralSignal(timeframe, now);
  }

  const first = points[0];
  const last = points[points.length - 1];
  let high = -Infinity;
  let low = Infinity;
  const prices: number[] = [];
  const returns: number[] = [];

  for (let i = 0; i < points.length; i += 1) {
    const price = Math.max(0, toFinite(points[i].priceUsd, 0));
    prices.push(price);
    if (price > high) high = price;
    if (price < low) low = price;
    if (i > 0) {
      const prev = prices[i - 1];
      if (prev > 0 && price > 0) {
        returns.push(Math.log(price / prev));
      }
    }
  }

  const open = Math.max(0, toFinite(first.priceUsd, 0));
  const close = Math.max(0, toFinite(last.priceUsd, 0));
  const returnPct = open > 0 ? ((close - open) / open) * 100 : 0;
  const rawSlope = linearSlope(prices);
  const slopePct = open > 0 ? (rawSlope / open) * 100 : 0;
  const volatilityPct = stddev(returns) * 100;
  const durationMs = Math.max(0, last.ts - first.ts);
  const coverage = clamp(durationMs / spanMs, 0, 1);

  // Score emphasizes directional consistency while penalizing noisy windows.
  const returnComponent = clamp(returnPct / 2.6, -1.2, 1.2);
  const slopeComponent = clamp(slopePct / 0.8, -1, 1);
  const volatilityPenalty = clamp(volatilityPct / 2.5, 0, 0.55);
  const score = clamp((returnComponent * 0.65 + slopeComponent * 0.35) - volatilityPenalty, -1, 1);

  return {
    candle: {
      timeframe,
      startTs: first.ts,
      endTs: last.ts,
      open: round(open, 8),
      high: round(high === -Infinity ? close : high, 8),
      low: round(low === Infinity ? close : low, 8),
      close: round(close, 8),
      samples: points.length,
      coverage: round(coverage, 4),
    },
    returnPct: round(returnPct, 4),
    slopePct: round(slopePct, 4),
    volatilityPct: round(volatilityPct, 4),
    score: round(score, 4),
  };
}

export function computeMultiTimeframeSignals(
  snapshots: QuantSnapshot[],
  now = Date.now(),
): MultiTimeframeSignals {
  const oneHour = signalForTimeframe("1h", snapshots, now);
  const fourHour = signalForTimeframe("4h", snapshots, now);
  const day = signalForTimeframe("24h", snapshots, now);

  const signals: Record<TimeframeKey, TimeframeSignal> = {
    "1h": oneHour,
    "4h": fourHour,
    "24h": day,
  };

  const validRows = (Object.entries(signals) as Array<[TimeframeKey, TimeframeSignal]>)
    .filter(([, row]) => row.candle.samples >= 2 && row.candle.coverage > 0.05);

  if (validRows.length === 0) {
    return {
      signals,
      weightedScore: 0,
      alignment: 0,
      coverage: 0,
      dominantTimeframe: "1h",
    };
  }

  let weightedScoreAcc = 0;
  let weightAcc = 0;
  let coverageAcc = 0;
  let alignmentSignedSum = 0;
  let dominant: { tf: TimeframeKey; strength: number } = { tf: "1h", strength: 0 };

  for (const [tf, row] of validRows) {
    const weight = TIMEFRAME_WEIGHTS[tf] * row.candle.coverage;
    weightedScoreAcc += row.score * weight;
    weightAcc += weight;
    coverageAcc += row.candle.coverage * TIMEFRAME_WEIGHTS[tf];
    alignmentSignedSum += Math.sign(row.score) * Math.min(1, Math.abs(row.score));

    const strength = Math.abs(row.score) * row.candle.coverage * TIMEFRAME_WEIGHTS[tf];
    if (strength > dominant.strength) {
      dominant = { tf, strength };
    }
  }

  const weightedScore = weightAcc > 0 ? weightedScoreAcc / weightAcc : 0;
  const alignment =
    validRows.length > 0
      ? Math.abs(alignmentSignedSum / validRows.length)
      : 0;

  return {
    signals,
    weightedScore: round(clamp(weightedScore, -1, 1), 4),
    alignment: round(clamp(alignment, 0, 1), 4),
    coverage: round(clamp(coverageAcc, 0, 1), 4),
    dominantTimeframe: dominant.tf,
  };
}

