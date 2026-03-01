/**
 * Kaspa BlockDAG-native signal computation.
 *
 * Kaspa is a BlockDAG that targets a fixed block rate (10 BPS on mainnet,
 * 10 BPS on TN10, 32 BPS on TN11). The DAA (Difficulty Adjustment Algorithm)
 * score is the network's monotonic clock — it increments by roughly one per
 * block, so its rate directly reflects actual on-chain throughput.
 *
 * By measuring the real-world DAA score velocity (scores/second) and comparing
 * it against the expected BPS, we can derive:
 *  - Network health (healthy / slow / surge)
 *  - DAG-native momentum bias (price × DAA correlation)
 *  - Adaptive cycle multiplier (react faster during surges, relax during lulls)
 *  - DAA scores since the last meaningful price move
 *
 * These signals are passed into the quant engine as external context so that
 * every trade decision is informed by real BlockDAG throughput — not just
 * wall-clock time.
 */

/** Expected Kaspa block-per-second rate by network. */
const EXPECTED_BPS: Record<string, number> = {
  mainnet: 10,
  "testnet-10": 10,
  "testnet-11": 32,
};

export interface DagSignals {
  /** Measured DAA scores per second (mainnet expected: 10). */
  bpsVelocity: number;
  /** % deviation from expected BPS. Positive = network accelerating. */
  bpsDeviation: number;
  /** Network throughput health classification. */
  networkHealth: "healthy" | "slow" | "surge";
  /** True when BPS is ≥ 40% above expected — high on-chain demand. */
  activitySurge: boolean;
  /**
   * DAG-native price momentum bias.
   * 1.0 = neutral. >1.0 = second-half-of-window price above first-half avg
   * (bullish DAG-price correlation). Range [0.7, 1.3].
   */
  dagMomentumBias: number;
  /**
   * Recommended interval multiplier for the next cycle.
   * 0.5 = halve the wait (surge detected).
   * 1.5 = extend the wait (quiet market).
   * 1.0 = normal.
   */
  cycleMultiplier: number;
  /** DAA score delta elapsed since the last ≥0.3% price move. */
  daaScoresSinceLastMove: number;
  /** Expected BPS for the active network (used for logging). */
  expectedBps: number;
}

/**
 * Compute Kaspa BlockDAG-native signals from market history snapshots.
 *
 * @param marketHistory - Sorted array of { ts, priceUsd, daaScore } snapshots.
 * @param network       - Active Kaspa network id (default: "mainnet").
 */
export function computeDagSignals(
  marketHistory: Array<{ ts: number; priceUsd: number; daaScore: number }>,
  network = "mainnet",
): DagSignals {
  const expectedBps = EXPECTED_BPS[network] ?? 10;

  const neutral: DagSignals = {
    bpsVelocity: expectedBps,
    bpsDeviation: 0,
    networkHealth: "healthy",
    activitySurge: false,
    dagMomentumBias: 1.0,
    cycleMultiplier: 1.0,
    daaScoresSinceLastMove: 0,
    expectedBps,
  };

  if (marketHistory.length < 3) return neutral;

  // Use last 12 snapshots for velocity measurement — enough for a stable
  // estimate but recent enough to detect regime changes within a few minutes.
  const window = marketHistory.slice(-12);
  const oldest = window[0];
  const newest = window[window.length - 1];

  const elapsedMs = newest.ts - oldest.ts;
  const elapsedSec = elapsedMs / 1000;
  const daaScoreDelta = newest.daaScore - oldest.daaScore;

  // Need at least 2 seconds of wall-clock time and positive DAA progress.
  if (elapsedSec < 2 || daaScoreDelta <= 0) return neutral;

  const bpsVelocity = daaScoreDelta / elapsedSec;
  const bpsDeviation = ((bpsVelocity - expectedBps) / expectedBps) * 100;

  // Classify network health:
  //   slow  = BPS < 65% of expected  → possible network stress / low hashrate
  //   surge = BPS > 140% of expected → high on-chain demand
  //   healthy = everything else
  let networkHealth: DagSignals["networkHealth"] = "healthy";
  if (bpsVelocity < expectedBps * 0.65) networkHealth = "slow";
  else if (bpsVelocity > expectedBps * 1.40) networkHealth = "surge";

  const activitySurge = networkHealth === "surge";

  // DAG-native momentum bias: compare avg price in the first half of the window
  // against the second half.  Uses DAG snapshot ordering (time-indexed by ts),
  // so it naturally aligns with actual block production timing.
  const pricePoints = window.map((s) => s.priceUsd).filter((p) => p > 0);
  let dagMomentumBias = 1.0;
  if (pricePoints.length >= 4) {
    const half = Math.floor(pricePoints.length / 2);
    const firstAvg = pricePoints.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const secondAvg =
      pricePoints.slice(half).reduce((a, b) => a + b, 0) / (pricePoints.length - half);
    if (firstAvg > 0) {
      dagMomentumBias = Math.min(1.3, Math.max(0.7, secondAvg / firstAvg));
    }
  }

  // Adaptive cycle multiplier:
  //   surge  → 0.5x (double frequency: react to high-demand regime faster)
  //   slow   → 1.5x (extend: no urgency, save API calls)
  //   large BPS deviation but not yet surge → 0.7x (intermediate response)
  //   normal → 1.0x
  let cycleMultiplier = 1.0;
  if (activitySurge) {
    cycleMultiplier = 0.5;
  } else if (networkHealth === "slow") {
    cycleMultiplier = 1.5;
  } else if (Math.abs(bpsDeviation) > 25) {
    cycleMultiplier = 0.7;
  }

  // DAA scores elapsed since the last meaningful (≥0.3%) price move.
  // A large value means the price has been stable for many blocks —
  // useful for dampening urgency when the market is quiet.
  let daaScoresSinceLastMove = 0;
  const latestPrice = newest.priceUsd;
  for (let i = window.length - 2; i >= 0; i--) {
    const snap = window[i];
    if (snap.priceUsd > 0 && latestPrice > 0) {
      const movePct = (Math.abs(latestPrice - snap.priceUsd) / snap.priceUsd) * 100;
      if (movePct >= 0.3) {
        daaScoresSinceLastMove = newest.daaScore - snap.daaScore;
        break;
      }
    }
  }

  return {
    bpsVelocity,
    bpsDeviation,
    networkHealth,
    activitySurge,
    dagMomentumBias,
    cycleMultiplier,
    daaScoresSinceLastMove,
    expectedBps,
  };
}

/** Format a DagSignals struct for a one-line log entry. */
export function formatDagSignalsLog(s: DagSignals): string {
  const bps = s.bpsVelocity.toFixed(1);
  const dev = (s.bpsDeviation >= 0 ? "+" : "") + s.bpsDeviation.toFixed(1) + "%";
  const health = s.networkHealth.toUpperCase();
  const bias = s.dagMomentumBias.toFixed(3);
  const cycle = s.cycleMultiplier !== 1.0 ? ` · next×${s.cycleMultiplier}` : "";
  const surge = s.activitySurge ? " · SURGE" : "";
  return `DAG · BPS ${bps}/${s.expectedBps} (${health}) · dev ${dev} · momentum ${bias}${cycle}${surge}`;
}
