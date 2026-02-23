/**
 * Data Loader for RL Training
 *
 * Loads and prepares historical Kaspa data for training
 */

import type { QuantSnapshot } from '../../quant/quantCore';

/**
 * Load historical data from localStorage or generate demo data
 */
export async function loadHistoricalData(
  startDate?: Date,
  endDate?: Date
): Promise<QuantSnapshot[]> {
  // Try to load from localStorage first
  const cached = loadFromCache();
  if (cached && cached.length > 0) {
    console.log(`📦 Loaded ${cached.length} data points from cache`);
    return filterByDate(cached, startDate, endDate);
  }

  // Otherwise, generate demo data or fetch from API
  console.log('⚠️ No cached data found. Generating demo data...');
  return generateDemoData(2000);
}

/**
 * Load from localStorage cache
 */
function loadFromCache(): QuantSnapshot[] | null {
  if (typeof localStorage === 'undefined') return null;

  const data = localStorage.getItem('kaspa_historical_data');
  if (!data) return null;

  try {
    return JSON.parse(data);
  } catch (e) {
    console.error('Failed to parse cached data:', e);
    return null;
  }
}

/**
 * Save to localStorage cache
 */
export function saveToCache(data: QuantSnapshot[]) {
  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem('kaspa_historical_data', JSON.stringify(data));
    console.log(`💾 Saved ${data.length} data points to cache`);
  } catch (e) {
    console.error('Failed to save data to cache:', e);
  }
}

/**
 * Filter data by date range
 */
function filterByDate(
  data: QuantSnapshot[],
  startDate?: Date,
  endDate?: Date
): QuantSnapshot[] {
  let filtered = data;

  if (startDate) {
    const startTs = startDate.getTime();
    filtered = filtered.filter(d => d.ts >= startTs);
  }

  if (endDate) {
    const endTs = endDate.getTime();
    filtered = filtered.filter(d => d.ts <= endTs);
  }

  return filtered;
}

/**
 * Generate demo data for testing
 */
function generateDemoData(points: number = 2000): QuantSnapshot[] {
  const data: QuantSnapshot[] = [];
  const startDate = Date.now() - (points * 3600000); // points hours ago

  let price = 0.12;  // Starting price
  let daaScore = 50000000;
  let walletKas = 1000;

  for (let i = 0; i < points; i++) {
    // Simulate price movement with trend + noise
    const trend = Math.sin(i / 100) * 0.02;
    const noise = (Math.random() - 0.5) * 0.01;
    const momentum = (Math.random() - 0.5) * 0.005;

    price = price * (1 + trend + noise + momentum);
    price = Math.max(0.05, Math.min(0.25, price)); // Clamp price

    // Simulate DAA score growth
    daaScore += Math.floor(Math.random() * 1000) + 500;

    // Simulate wallet balance changes
    const balanceChange = (Math.random() - 0.5) * 50;
    walletKas = Math.max(0, walletKas + balanceChange);

    data.push({
      ts: startDate + (i * 3600000), // Hourly data
      priceUsd: Number(price.toFixed(6)),
      daaScore: daaScore,
      walletKas: Number(walletKas.toFixed(2)),
    });
  }

  console.log(`✅ Generated ${points} demo data points`);
  console.log(`  Price range: $${Math.min(...data.map(d => d.priceUsd)).toFixed(4)} - $${Math.max(...data.map(d => d.priceUsd)).toFixed(4)}`);

  return data;
}

/**
 * Fetch real historical data from Kaspa API
 */
export async function fetchHistoricalDataFromAPI(
  days: number = 365
): Promise<QuantSnapshot[]> {
  console.log(`📡 Fetching ${days} days of historical data from Kaspa API...`);

  // This would fetch from actual Kaspa API
  // For now, return demo data
  // TODO: Implement actual API fetch

  /*
  const apiUrl = 'https://api.kaspa.org/historical';
  const endDate = Date.now();
  const startDate = endDate - (days * 86400000);

  const response = await fetch(`${apiUrl}?start=${startDate}&end=${endDate}`);
  const data = await response.json();

  return data.map((d: any) => ({
    ts: d.timestamp,
    priceUsd: d.price,
    daaScore: d.daaScore,
    walletKas: d.balance || 0,
  }));
  */

  return generateDemoData(days * 24); // Hourly data
}

/**
 * Split data into train/test sets
 */
export function trainTestSplit(
  data: QuantSnapshot[],
  trainRatio: number = 0.8
): { train: QuantSnapshot[], test: QuantSnapshot[] } {
  const splitIndex = Math.floor(data.length * trainRatio);

  return {
    train: data.slice(0, splitIndex),
    test: data.slice(splitIndex),
  };
}

/**
 * Walk-forward split (for realistic backtesting)
 */
export function walkForwardSplit(
  data: QuantSnapshot[],
  trainMonths: number = 6,
  testMonths: number = 2
): Array<{ train: QuantSnapshot[], test: QuantSnapshot[] }> {
  const splits: Array<{ train: QuantSnapshot[], test: QuantSnapshot[] }> = [];

  const trainPoints = trainMonths * 30 * 24; // Hourly data
  const testPoints = testMonths * 30 * 24;
  const stepSize = testPoints; // Roll forward by test period

  for (let i = 0; i + trainPoints + testPoints < data.length; i += stepSize) {
    splits.push({
      train: data.slice(i, i + trainPoints),
      test: data.slice(i + trainPoints, i + trainPoints + testPoints),
    });
  }

  console.log(`📊 Created ${splits.length} walk-forward splits`);
  return splits;
}
