export function toFinite(value: any, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function variance(values: number[]) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
}

export function stddev(values: number[]) {
  return Math.sqrt(Math.max(0, variance(values)));
}

export function last<T>(values: T[]) {
  return values[values.length - 1];
}

export function diff(values: number[]) {
  if (values.length < 2) return [];
  const out: number[] = [];
  for (let i = 1; i < values.length; i += 1) {
    out.push(values[i] - values[i - 1]);
  }
  return out;
}

export function pctChange(values: number[], periods = 1) {
  if (values.length <= periods) return 0;
  const end = last(values);
  const start = values[values.length - 1 - periods];
  if (!(start > 0) || !Number.isFinite(end)) return 0;
  return (end - start) / start;
}

export function logReturns(values: number[]) {
  const out: number[] = [];
  for (let i = 1; i < values.length; i += 1) {
    const prev = values[i - 1];
    const next = values[i];
    if (prev > 0 && next > 0) {
      out.push(Math.log(next / prev));
    }
  }
  return out;
}

export function ewmaVolatility(returns: number[], lambda = 0.94) {
  if (!returns.length) return 0;
  let varianceEstimate = returns[0] ** 2;
  for (let i = 1; i < returns.length; i += 1) {
    varianceEstimate = lambda * varianceEstimate + (1 - lambda) * returns[i] ** 2;
  }
  return Math.sqrt(Math.max(0, varianceEstimate));
}

export function linearSlope(values: number[]) {
  if (values.length < 2) return 0;
  const n = values.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

export function zScore(value: number, values: number[]) {
  if (!values.length) return 0;
  const sigma = stddev(values);
  if (sigma === 0) return 0;
  return (value - mean(values)) / sigma;
}

export function maxDrawdownPct(values: number[]) {
  if (!values.length) return 0;
  let peak = values[0];
  let drawdown = 0;
  for (const value of values) {
    if (value > peak) peak = value;
    if (peak > 0) {
      drawdown = Math.max(drawdown, (peak - value) / peak);
    }
  }
  return drawdown;
}

export function sigmoid(value: number) {
  if (value > 30) return 1;
  if (value < -30) return 0;
  return 1 / (1 + Math.exp(-value));
}

export function round(value: number, digits = 4) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function tail(values: number[], maxItems: number) {
  if (maxItems <= 0) return [];
  return values.slice(Math.max(0, values.length - maxItems));
}

// ===========================================
// ADVANCED TECHNICAL INDICATORS
// ===========================================

/**
 * RSI (Relative Strength Index)
 * Momentum oscillator that measures the speed and magnitude of price changes
 * @param values - Price series
 * @param period - RSI period (typically 14)
 * @returns RSI value 0-100
 */
export function rsi(values: number[], period = 14): number {
  if (values.length < period + 1) return 50; // Neutral if insufficient data
  
  const changes: number[] = [];
  for (let i = 1; i < values.length; i++) {
    changes.push(values[i] - values[i - 1]);
  }
  
  let avgGain = 0;
  let avgLoss = 0;
  
  // First period average
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;
  
  // Smoothed averages
  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
      avgGain = (avgGain * (period - 1)) / period;
    }
  }
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * MACD (Moving Average Convergence Divergence)
 * Trend-following momentum indicator
 * @param values - Price series
 * @param fastPeriod - Fast EMA period (typically 12)
 * @param slowPeriod - Slow EMA period (typically 26)
 * @param signalPeriod - Signal line period (typically 9)
 * @returns { macd, signal, histogram }
 */
export function macd(
  values: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): { macd: number; signal: number; histogram: number } {
  if (values.length < slowPeriod + signalPeriod) {
    return { macd: 0, signal: 0, histogram: 0 };
  }
  
  // Calculate EMAs
  const fastEma = ema(values, fastPeriod);
  const slowEma = ema(values, slowPeriod);
  const macdLine = fastEma - slowEma;
  
  // Calculate MACD line values for signal
  const macdValues: number[] = [];
  for (let i = slowPeriod; i < values.length; i++) {
    const fEma = ema(values.slice(0, i + 1), fastPeriod);
    const sEma = ema(values.slice(0, i + 1), slowPeriod);
    macdValues.push(fEma - sEma);
  }
  
  const signalLine = ema(macdValues, signalPeriod);
  const histogram = macdLine - signalLine;
  
  return { macd: macdLine, signal: signalLine, histogram };
}

/**
 * EMA (Exponential Moving Average)
 * @param values - Price series
 * @param period - EMA period
 * @returns EMA value
 */
export function ema(values: number[], period: number): number {
  if (values.length < period) return last(values) || 0;
  
  const multiplier = 2 / (period + 1);
  let emaValue = mean(values.slice(0, period));
  
  for (let i = period; i < values.length; i++) {
    emaValue = (values[i] - emaValue) * multiplier + emaValue;
  }
  
  return emaValue;
}

/**
 * SMA (Simple Moving Average)
 * @param values - Price series
 * @param period - SMA period
 * @returns SMA value
 */
export function sma(values: number[], period: number): number {
  if (values.length < period) return mean(values);
  return mean(values.slice(values.length - period));
}

/**
 * Bollinger Bands
 * Volatility bands above and below a moving average
 * @param values - Price series
 * @param period - Period for SMA (typically 20)
 * @param stdDevMult - Standard deviation multiplier (typically 2)
 * @returns { upper, middle, lower, bandwidth, percentB }
 */
export function bollingerBands(
  values: number[],
  period = 20,
  stdDevMult = 2
): { upper: number; middle: number; lower: number; bandwidth: number; percentB: number } {
  if (values.length < period) {
    const mid = mean(values);
    return { upper: mid, middle: mid, lower: mid, bandwidth: 0, percentB: 0.5 };
  }
  
  const recent = tail(values, period);
  const middle = sma(values, period);
  const std = stddev(recent);
  
  const upper = middle + std * stdDevMult;
  const lower = middle - std * stdDevMult;
  const bandwidth = (upper - lower) / middle;
  
  const currentPrice = last(values);
  const percentB = (currentPrice - lower) / (upper - lower);
  
  return { upper, middle, lower, bandwidth, percentB };
}

/**
 * ATR (Average True Range)
 * Measures market volatility
 * @param highPrices - High price series
 * @param lowPrices - Low price series  
 * @param closePrices - Close price series
 * @param period - ATR period (typically 14)
 * @returns ATR value
 */
export function atr(
  highPrices: number[],
  lowPrices: number[],
  closePrices: number[],
  period = 14
): number {
  if (highPrices.length < 2 || closePrices.length < 2) return 0;
  
  const trueRanges: number[] = [];
  for (let i = 1; i < closePrices.length; i++) {
    const high = highPrices[i];
    const low = lowPrices[i];
    const prevClose = closePrices[i - 1];
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }
  
  if (trueRanges.length < period) return mean(trueRanges) || 0;
  
  // First ATR is simple average
  let atrValue = mean(trueRanges.slice(0, period));
  
  // Subsequent ATRs use smoothed formula
  for (let i = period; i < trueRanges.length; i++) {
    atrValue = (atrValue * (period - 1) + trueRanges[i]) / period;
  }
  
  return atrValue;
}

/**
 * Stochastic Oscillator
 * Momentum indicator comparing closing price to price range
 * @param highPrices - High price series
 * @param lowPrices - Low price series
 * @param closePrices - Close price series
 * @param kPeriod - %K period (typically 14)
 * @param dPeriod - %D period (typically 3)
 * @returns { k, d }
 */
export function stochastic(
  highPrices: number[],
  lowPrices: number[],
  closePrices: number[],
  kPeriod = 14,
  dPeriod = 3
): { k: number; d: number } {
  if (closePrices.length < kPeriod) return { k: 50, d: 50 };
  
  const kValues: number[] = [];
  
  for (let i = kPeriod - 1; i < closePrices.length; i++) {
    const lookback = highPrices.slice(Math.max(0, i - kPeriod + 1), i + 1);
    const lowLookback = lowPrices.slice(Math.max(0, i - kPeriod + 1), i + 1);
    
    const highestHigh = Math.max(...lookback);
    const lowestLow = Math.min(...lowLookback);
    const close = closePrices[i];
    
    if (highestHigh === lowestLow) {
      kValues.push(50);
    } else {
      kValues.push(((close - lowestLow) / (highestHigh - lowestLow)) * 100);
    }
  }
  
  const k = last(kValues) || 50;
  const d = sma(kValues.slice(-dPeriod), Math.min(dPeriod, kValues.length));
  
  return { k, d };
}

/**
 * VWAP (Volume Weighted Average Price) approximation
 * For UTXO chains, we use transaction count as proxy
 * @param prices - Price series
 * @param volumes - Volume/transactions series
 * @returns VWAP value
 */
export function vwap(prices: number[], volumes: number[]): number {
  if (prices.length !== volumes.length || prices.length === 0) return mean(prices);
  
  let totalPVT = 0;
  let totalVolume = 0;
  
  for (let i = 0; i < prices.length; i++) {
    const volume = volumes[i] || 1;
    totalPVT += prices[i] * volume;
    totalVolume += volume;
  }
  
  return totalVolume > 0 ? totalPVT / totalVolume : mean(prices);
}

/**
 * Calculate Multi-Timeframe Convergence Score
 * Higher score = more alignment across timeframes (stronger signal)
 * @param shortTerm - Short-term indicator value (e.g., 1-min RSI)
 * @param mediumTerm - Medium-term indicator value (e.g., 15-min RSI)
 * @param longTerm - Long-term indicator value (e.g., 1-hour RSI)
 * @returns Convergence score -1 to 1
 */
export function timeframeConvergence(shortTerm: number, mediumTerm: number, longTerm: number): number {
  // Normalize to -1 to 1 range
  const normalize = (val: number) => (val - 50) / 50;
  
  const nShort = normalize(shortTerm);
  const nMedium = normalize(mediumTerm);
  const nLong = normalize(longTerm);
  
  // Calculate alignment
  const alignment = (nShort + nMedium + nLong) / 3;
  
  // Check if all point same direction
  const allPositive = nShort > 0.1 && nMedium > 0.1 && nLong > 0.1;
  const allNegative = nShort < -0.1 && nMedium < -0.1 && nLong < -0.1;
  
  if (allPositive) return Math.min(1, alignment + 0.2);
  if (allNegative) return Math.max(-1, alignment - 0.2);
  
  return alignment * 0.5; // Reduced if mixed
}

/**
 * Calculate Value at Risk (VaR) at specified confidence level
 * @param returns - Return series
 * @param confidence - Confidence level (e.g., 0.95 for 95%)
 * @returns VaR as decimal (e.g., 0.02 = 2% potential loss)
 */
export function valueAtRisk(returns: number[], confidence = 0.95): number {
  if (returns.length < 10) return 0.05; // Conservative default
  
  const sorted = [...returns].sort((a, b) => a - b);
  const index = Math.floor((1 - confidence) * sorted.length);
  
  return Math.abs(sorted[index] || 0.05);
}

/**
 * Calculate Expected Shortfall (CVaR) - average loss beyond VaR
 * @param returns - Return series
 * @param confidence - Confidence level
 * @returns Expected shortfall as decimal
 */
export function expectedShortfall(returns: number[], confidence = 0.95): number {
  if (returns.length < 10) return 0.075; // Conservative default
  
  const sorted = [...returns].sort((a, b) => a - b);
  const varIndex = Math.floor((1 - confidence) * sorted.length);
  
  let sum = 0;
  let count = 0;
  for (let i = 0; i <= varIndex; i++) {
    sum += sorted[i];
    count++;
  }
  
  return Math.abs(count > 0 ? sum / count : 0.075);
}

/**
 * Calculate Sortino Ratio (risk-adjusted return using downside deviation)
 * @param returns - Return series
 * @param targetReturn - Target/minimum acceptable return
 * @returns Sortino ratio
 */
export function sortinoRatio(returns: number[], targetReturn = 0): number {
  if (returns.length < 2) return 0;
  
  const avgReturn = mean(returns);
  
  // Downside returns only
  const downsideReturns = returns.filter(r => r < targetReturn);
  const downsideDeviation = downsideReturns.length > 0 
    ? Math.sqrt(variance(downsideReturns))
    : 0;
  
  if (downsideDeviation === 0) return 0;
  
  return (avgReturn - targetReturn) / downsideDeviation;
}

/**
 * Calculate Calmar Ratio (return / max drawdown)
 * @param returns - Return series
 * @param maxDrawdown - Maximum drawdown as decimal
 * @returns Calmar ratio
 */
export function calmarRatio(returns: number[], maxDrawdown: number): number {
  if (maxDrawdown === 0) return 0;
  
  const totalReturn = returns.reduce((sum, r) => sum + r, 0);
  const annualizedReturn = totalReturn / returns.length * 252; // Approximate annualization
  
  return annualizedReturn / maxDrawdown;
}
