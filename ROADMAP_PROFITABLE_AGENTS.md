# 🎯 Roadmap: Making ForgeOS Agents Genuinely Profitable

**Goal**: Transform ForgeOS from a technical demo into a system that generates real trading alpha.

---

## 🔍 Current State Analysis

### What You Have (Strong Foundation)
```typescript
✓ Multi-timeframe momentum scoring
✓ EWMA volatility estimation
✓ Kelly fraction sizing with risk caps
✓ DAA trend analysis (Kaspa-native edge)
✓ Regime detection (5 regimes)
✓ Win probability model (sigmoid-based)
✓ Data quality scoring
✓ Advanced technical indicators (RSI, MACD, Bollinger, ATR, Stochastic)
✓ AI overlay with quant guardrails
✓ Multi-agent portfolio allocation
✓ Receipt-aware execution tracking
```

### What's Missing for Real Alpha
```text
❌ Backtesting engine (can't validate strategies)
❌ Machine learning from past decisions
❌ On-chain metrics (whale movements, UTXO age, exchange flows)
❌ Social sentiment analysis (Twitter, Discord, Telegram)
❌ Order book depth analysis
❌ Cross-asset correlation (BTC correlation, alt season)
❌ Mean reversion detection
❌ Support/resistance levels
❌ Pattern recognition
❌ Multi-model AI ensemble
❌ Strategy parameter optimization
❌ Execution intelligence (TWAP/VWAP, slippage modeling)
❌ Portfolio theory (correlation across agents, drawdown limits)
```

---

## 📋 Implementation Phases

### **Phase 1: Enhanced Market Intelligence** (Week 1-2)
**Goal**: Give agents more market context beyond just price

#### 1.1 On-Chain Metrics Integration
```typescript
// src/quant/onchain.ts

export type OnChainMetrics = {
  whale_activity_score: number;        // 0-1: Large UTXO movements
  utxo_age_distribution: number;       // % of old UTXOs (holder confidence)
  exchange_flow_net: number;           // Net exchange inflow/outflow
  active_addresses_24h: number;        // Network activity
  transaction_velocity: number;        // TX per block
  miner_to_exchange_flow: number;      // Miner selling pressure
  large_tx_count_24h: number;          // Whale transaction count
};

export async function fetchOnChainMetrics(
  network: 'mainnet' | 'testnet'
): Promise<OnChainMetrics> {
  // Option 1: Use Kaspa API endpoints
  const apiBase = network === 'mainnet'
    ? 'https://api.kaspa.org'
    : 'https://api-tn10.kaspanet.io';

  // Option 2: Use explorer API
  const explorerBase = 'https://api.kas.fyi';

  // Fetch metrics
  const [utxoData, txData, addressData] = await Promise.all([
    fetch(`${apiBase}/info/utxo-stats`).then(r => r.json()),
    fetch(`${explorerBase}/transactions/stats/24h`).then(r => r.json()),
    fetch(`${explorerBase}/addresses/active/24h`).then(r => r.json()),
  ]);

  // Compute whale activity (transactions > 100K KAS)
  const largeTxs = txData.transactions?.filter(
    (tx: any) => (tx.outputs?.reduce((sum: number, o: any) =>
      sum + (o.amount || 0), 0) / 100_000_000) > 100_000
  ) || [];

  const whaleActivityScore = Math.min(1, largeTxs.length / 50);

  // UTXO age distribution (older = more conviction)
  const utxoAgeDistribution = utxoData.old_utxo_percentage || 0;

  // Exchange flow (needs exchange address tracking)
  const knownExchangeAddresses = [
    // Add known exchange addresses
  ];

  return {
    whale_activity_score: whaleActivityScore,
    utxo_age_distribution: utxoAgeDistribution,
    exchange_flow_net: 0, // TODO: Implement
    active_addresses_24h: addressData.active_count || 0,
    transaction_velocity: txData.tx_per_block || 0,
    miner_to_exchange_flow: 0, // TODO: Implement
    large_tx_count_24h: largeTxs.length,
  };
}
```

#### 1.2 Social Sentiment Analysis
```typescript
// src/quant/sentiment.ts

export type SentimentMetrics = {
  twitter_sentiment: number;           // -1 to 1
  discord_activity_score: number;      // 0-1
  reddit_mentions_24h: number;
  news_sentiment: number;              // -1 to 1
  influencer_mentions: number;
  fear_greed_index: number;            // 0-100
};

export async function fetchSentimentMetrics(): Promise<SentimentMetrics> {
  // Option 1: Use sentiment API (e.g., LunarCrush, Santiment)
  // Option 2: Build custom Twitter scraper
  // Option 3: Use AI to analyze social posts

  const twitterSentiment = await analyzeTwitterSentiment();
  const discordActivity = await analyzeDiscordActivity();

  return {
    twitter_sentiment: twitterSentiment,
    discord_activity_score: discordActivity,
    reddit_mentions_24h: 0,
    news_sentiment: 0,
    influencer_mentions: 0,
    fear_greed_index: 50,
  };
}

async function analyzeTwitterSentiment(): Promise<number> {
  // Use AI to analyze recent tweets
  const tweets = await fetchRecentKaspaTweets();

  // Send to AI for sentiment analysis
  const prompt = `Analyze the sentiment of these Kaspa-related tweets.
  Return a score from -1 (very bearish) to +1 (very bullish):

  ${tweets.map(t => `- ${t.text}`).join('\n')}

  Return only a number between -1 and 1.`;

  // Call AI API
  const sentiment = await callSentimentAI(prompt);
  return clamp(sentiment, -1, 1);
}
```

#### 1.3 Order Book Depth Analysis
```typescript
// src/quant/orderbook.ts

export type OrderBookMetrics = {
  bid_ask_spread_pct: number;
  bid_depth_10pct: number;             // Total bids within 10% of mid
  ask_depth_10pct: number;             // Total asks within 10% of mid
  imbalance_ratio: number;             // bid_depth / ask_depth
  liquidity_score: number;             // 0-1: Overall liquidity
};

export async function fetchOrderBookMetrics(): Promise<OrderBookMetrics> {
  // Fetch order book from exchanges
  // (Kaspa exchanges: TradeOgre, MEXC, etc.)

  const orderBook = await fetchKaspaOrderBook();

  const midPrice = (orderBook.bestBid + orderBook.bestAsk) / 2;
  const spread = ((orderBook.bestAsk - orderBook.bestBid) / midPrice) * 100;

  // Calculate depth within 10% of mid price
  const bid10pct = midPrice * 0.9;
  const ask10pct = midPrice * 1.1;

  const bidDepth = orderBook.bids
    .filter((b: any) => b.price >= bid10pct)
    .reduce((sum: number, b: any) => sum + b.amount, 0);

  const askDepth = orderBook.asks
    .filter((a: any) => a.price <= ask10pct)
    .reduce((sum: number, a: any) => sum + a.amount, 0);

  const imbalance = bidDepth / Math.max(1, askDepth);
  const liquidity = Math.min(1, (bidDepth + askDepth) / 1_000_000);

  return {
    bid_ask_spread_pct: spread,
    bid_depth_10pct: bidDepth,
    ask_depth_10pct: askDepth,
    imbalance_ratio: imbalance,
    liquidity_score: liquidity,
  };
}
```

#### 1.4 Integrate into Quant Core
```typescript
// src/quant/quantCore.ts (enhanced)

export type EnhancedQuantSnapshot = QuantSnapshot & {
  onchain?: OnChainMetrics;
  sentiment?: SentimentMetrics;
  orderbook?: OrderBookMetrics;
  btc_correlation?: number;
};

export function buildQuantCoreDecision(
  agent: any,
  kasData: EnhancedQuantSnapshot,
  context?: QuantContext
): QuantDecisionDraft {
  // ... existing logic ...

  // NEW: On-chain signal integration
  const onchainScore = computeOnChainScore(kasData.onchain);
  const sentimentScore = computeSentimentScore(kasData.sentiment);
  const liquidityScore = kasData.orderbook?.liquidity_score || 0.5;

  // Enhanced win probability with new signals
  const winProbabilityRaw = sigmoid(
    0.1 +
    momentumBoost * 1.25 +
    daaTrendScore * 0.55 +
    onchainScore * 0.45 +          // NEW
    sentimentScore * 0.35 +        // NEW
    -volatilityPenalty * 0.55 +
    -drawdownPenalty * 0.6
  );

  // ... rest of logic ...
}

function computeOnChainScore(onchain?: OnChainMetrics): number {
  if (!onchain) return 0;

  // Bullish signals:
  // - High UTXO age (holders not selling)
  // - Low exchange inflow (no selling pressure)
  // - High active addresses (network activity)

  const utxoSignal = onchain.utxo_age_distribution > 0.6 ? 0.3 : -0.2;
  const flowSignal = onchain.exchange_flow_net < 0 ? 0.25 : -0.25;
  const activitySignal = onchain.active_addresses_24h > 5000 ? 0.2 : 0;
  const whaleSignal = onchain.whale_activity_score > 0.7 ? -0.3 : 0.1;

  return clamp(utxoSignal + flowSignal + activitySignal + whaleSignal, -1, 1);
}

function computeSentimentScore(sentiment?: SentimentMetrics): number {
  if (!sentiment) return 0;

  // Combine social signals
  const twitterWeight = 0.4;
  const discordWeight = 0.3;
  const fearGreedWeight = 0.3;

  const fearGreedNormalized = (sentiment.fear_greed_index - 50) / 50;

  return clamp(
    sentiment.twitter_sentiment * twitterWeight +
    (sentiment.discord_activity_score - 0.5) * 2 * discordWeight +
    fearGreedNormalized * fearGreedWeight,
    -1,
    1
  );
}
```

---

### **Phase 2: Advanced Quant Models** (Week 3-4)
**Goal**: Add sophisticated trading strategies beyond simple momentum

#### 2.1 Mean Reversion Detection
```typescript
// src/quant/meanReversion.ts

export type MeanReversionSignal = {
  is_oversold: boolean;
  is_overbought: boolean;
  reversion_strength: number;      // 0-1
  bb_position: number;             // -1 (lower band) to 1 (upper band)
  rsi_level: number;               // 0-100
};

export function detectMeanReversion(
  priceSeries: number[],
  period = 20
): MeanReversionSignal {
  const currentPrice = last(priceSeries);

  // Bollinger Bands
  const bb = bollingerBands(priceSeries, period, 2);
  const bbPosition = (currentPrice - bb.middle) / (bb.upper - bb.middle);

  // RSI
  const rsiValue = rsi(priceSeries, 14);

  // Detection logic
  const isOversold = rsiValue < 30 && bbPosition < -0.8;
  const isOverbought = rsiValue > 70 && bbPosition > 0.8;

  // Reversion strength (how extreme is the deviation)
  const reversionStrength = Math.min(1, Math.abs(bbPosition));

  return {
    is_oversold: isOversold,
    is_overbought: isOverbought,
    reversion_strength: reversionStrength,
    bb_position: bbPosition,
    rsi_level: rsiValue,
  };
}
```

#### 2.2 Trend Strength (ADX + Moving Average Crossovers)
```typescript
// src/quant/trendStrength.ts

export type TrendStrengthSignal = {
  adx: number;                     // 0-100 (>25 = strong trend)
  trend_direction: 'up' | 'down' | 'none';
  ema_crossover: 'bullish' | 'bearish' | 'none';
  macd_signal: 'bullish' | 'bearish' | 'neutral';
};

export function analyzeTrendStrength(
  priceSeries: number[],
  highSeries: number[],
  lowSeries: number[]
): TrendStrengthSignal {
  // ADX (Average Directional Index)
  const adxValue = adx(highSeries, lowSeries, priceSeries, 14);

  // EMA crossovers (golden cross / death cross)
  const ema12 = ema(priceSeries, 12);
  const ema26 = ema(priceSeries, 26);
  const prevEma12 = ema(priceSeries.slice(0, -1), 12);
  const prevEma26 = ema(priceSeries.slice(0, -1), 26);

  let emaCrossover: 'bullish' | 'bearish' | 'none' = 'none';
  if (ema12 > ema26 && prevEma12 <= prevEma26) {
    emaCrossover = 'bullish';  // Golden cross
  } else if (ema12 < ema26 && prevEma12 >= prevEma26) {
    emaCrossover = 'bearish';  // Death cross
  }

  // MACD
  const macdData = macd(priceSeries, 12, 26, 9);
  const macdSignal = macdData.histogram > 0 ? 'bullish' :
                     macdData.histogram < 0 ? 'bearish' : 'neutral';

  // Trend direction
  const trendDirection = ema12 > ema26 ? 'up' :
                         ema12 < ema26 ? 'down' : 'none';

  return {
    adx: adxValue,
    trend_direction: trendDirection,
    ema_crossover: emaCrossover,
    macd_signal: macdSignal,
  };
}

// Implement ADX calculation
function adx(
  high: number[],
  low: number[],
  close: number[],
  period: number
): number {
  // ADX calculation (simplified)
  // Full implementation requires +DI, -DI, and smoothing

  // ... implementation ...

  return 25; // Placeholder
}
```

#### 2.3 Support/Resistance Detection
```typescript
// src/quant/supportResistance.ts

export type SupportResistanceLevel = {
  price: number;
  strength: number;              // 0-1: How strong is this level
  type: 'support' | 'resistance';
  touches: number;               // How many times price hit this level
};

export function findSupportResistance(
  priceSeries: number[],
  tolerance = 0.02                // 2% tolerance for level clustering
): SupportResistanceLevel[] {
  const levels: SupportResistanceLevel[] = [];

  // Find local peaks and valleys
  for (let i = 2; i < priceSeries.length - 2; i++) {
    const current = priceSeries[i];
    const prev2 = priceSeries[i - 2];
    const prev1 = priceSeries[i - 1];
    const next1 = priceSeries[i + 1];
    const next2 = priceSeries[i + 2];

    // Local maximum (resistance)
    if (current > prev2 && current > prev1 &&
        current > next1 && current > next2) {
      levels.push({
        price: current,
        strength: 0.5,
        type: 'resistance',
        touches: 1,
      });
    }

    // Local minimum (support)
    if (current < prev2 && current < prev1 &&
        current < next1 && current < next2) {
      levels.push({
        price: current,
        strength: 0.5,
        type: 'support',
        touches: 1,
      });
    }
  }

  // Cluster nearby levels
  const clustered = clusterLevels(levels, tolerance);

  // Calculate strength based on touches and recency
  return clustered.map(level => ({
    ...level,
    strength: Math.min(1, level.touches / 5),
  }));
}

function clusterLevels(
  levels: SupportResistanceLevel[],
  tolerance: number
): SupportResistanceLevel[] {
  // Cluster levels within tolerance % of each other
  const clusters: SupportResistanceLevel[] = [];

  for (const level of levels) {
    const existing = clusters.find(c =>
      Math.abs(c.price - level.price) / level.price < tolerance &&
      c.type === level.type
    );

    if (existing) {
      existing.touches += 1;
      existing.price = (existing.price + level.price) / 2;
    } else {
      clusters.push({ ...level });
    }
  }

  return clusters.sort((a, b) => b.strength - a.strength);
}
```

---

### **Phase 3: AI Enhancement** (Week 5-6)
**Goal**: Make AI overlay genuinely intelligent for trading

#### 3.1 Enhanced AI Prompts
```typescript
// src/quant/runQuantEngineAiTransport.ts (enhanced)

function buildEnhancedAiPrompt(
  quantCore: QuantDecisionDraft,
  marketContext: {
    onchain: OnChainMetrics;
    sentiment: SentimentMetrics;
    orderbook: OrderBookMetrics;
    meanReversion: MeanReversionSignal;
    trendStrength: TrendStrengthSignal;
    supportResistance: SupportResistanceLevel[];
  }
): string {
  return `You are an elite quantitative trading AI analyzing Kaspa (KAS) cryptocurrency.

## Current Market State

**Price Action:**
- Price: $${quantCore.quant_metrics.price_usd}
- 1-period return: ${quantCore.quant_metrics.price_return_1_pct}%
- 5-period return: ${quantCore.quant_metrics.price_return_5_pct}%
- 20-period return: ${quantCore.quant_metrics.price_return_20_pct}%
- Volatility (EWMA): ${quantCore.quant_metrics.ewma_volatility}
- Regime: ${quantCore.quant_metrics.regime}

**On-Chain Metrics:**
- Whale Activity: ${marketContext.onchain.whale_activity_score.toFixed(2)} (0-1)
- UTXO Age Distribution: ${(marketContext.onchain.utxo_age_distribution * 100).toFixed(1)}% old
- Active Addresses (24h): ${marketContext.onchain.active_addresses_24h}
- Large Transactions (24h): ${marketContext.onchain.large_tx_count_24h}

**Social Sentiment:**
- Twitter Sentiment: ${marketContext.sentiment.twitter_sentiment.toFixed(2)} (-1 to 1)
- Discord Activity: ${marketContext.sentiment.discord_activity_score.toFixed(2)} (0-1)
- Fear/Greed Index: ${marketContext.sentiment.fear_greed_index}/100

**Technical Analysis:**
- RSI: ${marketContext.meanReversion.rsi_level.toFixed(1)}
- Bollinger Band Position: ${marketContext.meanReversion.bb_position.toFixed(2)} (-1 to 1)
- Trend Strength (ADX): ${marketContext.trendStrength.adx.toFixed(1)}
- Trend Direction: ${marketContext.trendStrength.trend_direction}
- EMA Crossover: ${marketContext.trendStrength.ema_crossover}
- MACD Signal: ${marketContext.trendStrength.macd_signal}

**Order Book:**
- Bid/Ask Spread: ${marketContext.orderbook.bid_ask_spread_pct.toFixed(2)}%
- Bid/Ask Imbalance: ${marketContext.orderbook.imbalance_ratio.toFixed(2)}
- Liquidity Score: ${marketContext.orderbook.liquidity_score.toFixed(2)} (0-1)

**Support/Resistance Levels:**
${marketContext.supportResistance.slice(0, 3).map(sr =>
  `- ${sr.type.toUpperCase()}: $${sr.price.toFixed(4)} (strength: ${sr.strength.toFixed(2)}, touches: ${sr.touches})`
).join('\n')}

**Quant Core Baseline:**
- Action: ${quantCore.action}
- Confidence: ${quantCore.confidence_score.toFixed(2)}
- Kelly Fraction: ${quantCore.kelly_fraction.toFixed(4)}
- Expected Value: ${quantCore.expected_value_pct.toFixed(2)}%
- Win Probability: ${quantCore.monte_carlo_win_pct.toFixed(1)}%

## Your Task

Analyze ALL signals above and provide a superior trading decision.

Consider:
1. **Mean Reversion**: Is price oversold/overbought? Should we fade the move?
2. **Trend Following**: Is trend strong enough to ride? Or is it exhausting?
3. **On-Chain Edge**: Do whale movements predict price action?
4. **Sentiment Edge**: Is social sentiment ahead of or lagging price?
5. **Liquidity**: Is there enough depth to execute without slippage?
6. **Support/Resistance**: Are we near key levels? Breakout or bounce?

Return JSON:
{
  "action": "ACCUMULATE" | "REDUCE" | "HOLD" | "REBALANCE",
  "confidence_score": 0.0-1.0,
  "kelly_fraction": 0.0-0.20,
  "reasoning": "Your detailed analysis incorporating ALL signals",
  "edge_identified": "What specific edge are you exploiting?",
  "risk_factors": ["factor1", "factor2"],
  "expected_value_pct": number,
  "strategy_type": "trend_following" | "mean_reversion" | "breakout" | "consolidation"
}`;
}
```

#### 3.2 Multi-Model Ensemble
```typescript
// src/quant/aiEnsemble.ts

export type AiModel = 'claude-sonnet' | 'gpt-4' | 'gpt-4-turbo';

export async function ensembleAiDecision(
  prompt: string,
  models: AiModel[] = ['claude-sonnet', 'gpt-4']
): Promise<any> {
  // Call multiple AI models in parallel
  const decisions = await Promise.allSettled(
    models.map(model => callAiModel(model, prompt))
  );

  const successfulDecisions = decisions
    .filter(d => d.status === 'fulfilled')
    .map(d => (d as any).value);

  if (successfulDecisions.length === 0) {
    throw new Error('All AI models failed');
  }

  // Ensemble strategy: Average confidence, majority vote on action
  const actionVotes: Record<string, number> = {};
  let totalConfidence = 0;
  let totalKelly = 0;

  for (const decision of successfulDecisions) {
    actionVotes[decision.action] = (actionVotes[decision.action] || 0) + 1;
    totalConfidence += decision.confidence_score;
    totalKelly += decision.kelly_fraction;
  }

  // Majority vote
  const majorityAction = Object.entries(actionVotes)
    .sort((a, b) => b[1] - a[1])[0][0];

  // Average confidence & kelly
  const avgConfidence = totalConfidence / successfulDecisions.length;
  const avgKelly = totalKelly / successfulDecisions.length;

  // Reduce confidence if models disagree
  const agreementPenalty = actionVotes[majorityAction] / successfulDecisions.length;

  return {
    action: majorityAction,
    confidence_score: avgConfidence * agreementPenalty,
    kelly_fraction: avgKelly,
    reasoning: `Ensemble of ${successfulDecisions.length} models. Agreement: ${(agreementPenalty * 100).toFixed(0)}%`,
    model_votes: actionVotes,
  };
}

async function callAiModel(model: AiModel, prompt: string): Promise<any> {
  switch (model) {
    case 'claude-sonnet':
      return callClaudeApi(prompt);
    case 'gpt-4':
    case 'gpt-4-turbo':
      return callOpenAiApi(model, prompt);
    default:
      throw new Error(`Unknown model: ${model}`);
  }
}
```

---

### **Phase 4: Backtesting Engine** (Week 7-8)
**Goal**: Validate that strategies actually work on historical data

#### 4.1 Backtesting Framework
```typescript
// src/backtest/engine.ts

export type BacktestConfig = {
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  agent: any;
  strategyParams: any;
};

export type BacktestResult = {
  total_return_pct: number;
  sharpe_ratio: number;
  max_drawdown_pct: number;
  win_rate: number;
  total_trades: number;
  profitable_trades: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  profit_factor: number;
  trades: Trade[];
};

export type Trade = {
  timestamp: number;
  action: 'buy' | 'sell';
  price: number;
  amount: number;
  pnl_pct?: number;
};

export async function runBacktest(
  config: BacktestConfig
): Promise<BacktestResult> {
  // Load historical data
  const historicalData = await loadHistoricalKaspaData(
    config.startDate,
    config.endDate
  );

  let capital = config.initialCapital;
  let position = 0;
  const trades: Trade[] = [];

  // Simulate trading
  for (let i = 48; i < historicalData.length; i++) {
    const snapshot = historicalData[i];
    const history = historicalData.slice(Math.max(0, i - 240), i);

    // Run quant engine
    const decision = buildQuantCoreDecision(
      config.agent,
      snapshot,
      { history }
    );

    // Execute trade
    if (decision.action === 'ACCUMULATE' && position === 0) {
      // Buy
      const buyAmount = capital * decision.kelly_fraction;
      position = buyAmount / snapshot.priceUsd;
      capital -= buyAmount;

      trades.push({
        timestamp: snapshot.ts,
        action: 'buy',
        price: snapshot.priceUsd,
        amount: position,
      });
    } else if (decision.action === 'REDUCE' && position > 0) {
      // Sell
      const sellValue = position * snapshot.priceUsd;
      capital += sellValue;

      // Calculate P&L
      const lastBuy = [...trades].reverse().find(t => t.action === 'buy');
      const pnlPct = lastBuy
        ? ((snapshot.priceUsd - lastBuy.price) / lastBuy.price) * 100
        : 0;

      trades.push({
        timestamp: snapshot.ts,
        action: 'sell',
        price: snapshot.priceUsd,
        amount: position,
        pnl_pct: pnlPct,
      });

      position = 0;
    }
  }

  // Close any open position
  if (position > 0) {
    const lastPrice = last(historicalData).priceUsd;
    capital += position * lastPrice;
    position = 0;
  }

  // Calculate metrics
  const totalReturn = ((capital - config.initialCapital) / config.initialCapital) * 100;
  const profitableTrades = trades.filter(t => (t.pnl_pct || 0) > 0).length;
  const winRate = profitableTrades / Math.max(1, trades.length / 2);

  // ... calculate other metrics ...

  return {
    total_return_pct: totalReturn,
    sharpe_ratio: 0, // TODO: Calculate
    max_drawdown_pct: 0, // TODO: Calculate
    win_rate: winRate,
    total_trades: trades.length / 2,
    profitable_trades: profitableTrades,
    avg_win_pct: 0, // TODO: Calculate
    avg_loss_pct: 0, // TODO: Calculate
    profit_factor: 0, // TODO: Calculate
    trades,
  };
}

async function loadHistoricalKaspaData(
  startDate: Date,
  endDate: Date
): Promise<QuantSnapshot[]> {
  // Load from:
  // 1. Local cache (if available)
  // 2. Kaspa API historical endpoints
  // 3. Third-party data providers

  // For now, placeholder
  return [];
}
```

#### 4.2 Walk-Forward Optimization
```typescript
// src/backtest/optimization.ts

export type OptimizationParams = {
  kellyCap: number[];              // e.g. [0.05, 0.08, 0.12, 0.15]
  riskCeiling: number[];           // e.g. [0.42, 0.55, 0.65, 0.75]
  momentumWeights: number[][];     // Different weight combinations
  stopLossPct: number[];
  takeProfitPct: number[];
};

export async function walkForwardOptimization(
  agent: any,
  params: OptimizationParams,
  inSampleMonths: number = 6,
  outSampleMonths: number = 2
): Promise<any> {
  // Walk-forward optimization:
  // 1. Train on in-sample period
  // 2. Test on out-sample period
  // 3. Roll forward

  const results = [];

  // Generate parameter combinations
  const paramCombos = generateParamCombinations(params);

  for (const combo of paramCombos) {
    const agentWithParams = { ...agent, ...combo };

    // Backtest with these parameters
    const result = await runBacktest({
      startDate: new Date('2023-01-01'),
      endDate: new Date('2024-12-31'),
      initialCapital: 10000,
      agent: agentWithParams,
      strategyParams: combo,
    });

    results.push({
      params: combo,
      result,
    });
  }

  // Find best parameters by Sharpe ratio
  const best = results.sort((a, b) =>
    b.result.sharpe_ratio - a.result.sharpe_ratio
  )[0];

  return best;
}

function generateParamCombinations(params: OptimizationParams): any[] {
  // Generate all combinations of parameters
  const combos = [];

  for (const kelly of params.kellyCap) {
    for (const risk of params.riskCeiling) {
      combos.push({ kellyCap: kelly, riskCeiling: risk });
    }
  }

  return combos;
}
```

---

### **Phase 5: Execution Intelligence** (Week 9-10)
**Goal**: Minimize slippage and optimize execution

#### 5.1 TWAP/VWAP Execution
```typescript
// src/execution/smartExecution.ts

export type ExecutionStrategy = 'market' | 'twap' | 'vwap' | 'iceberg';

export type ExecutionParams = {
  totalAmount: number;
  strategy: ExecutionStrategy;
  duration?: number;              // For TWAP (in seconds)
  maxSlippagePct?: number;
  urgency?: 'low' | 'medium' | 'high';
};

export async function executeSmartOrder(
  params: ExecutionParams,
  wallet: any
): Promise<{ fills: any[]; avgPrice: number; slippage: number }> {
  switch (params.strategy) {
    case 'twap':
      return executeTWAP(params, wallet);
    case 'vwap':
      return executeVWAP(params, wallet);
    case 'market':
    default:
      return executeMarket(params, wallet);
  }
}

async function executeTWAP(
  params: ExecutionParams,
  wallet: any
): Promise<any> {
  // Time-Weighted Average Price
  // Split order into equal chunks over time

  const duration = params.duration || 300; // 5 minutes default
  const chunks = 10; // Split into 10 orders
  const chunkSize = params.totalAmount / chunks;
  const interval = duration / chunks;

  const fills = [];

  for (let i = 0; i < chunks; i++) {
    // Wait for interval
    if (i > 0) {
      await sleep(interval * 1000);
    }

    // Execute chunk
    const fill = await executeMarketOrder(chunkSize, wallet);
    fills.push(fill);

    // Check if max slippage exceeded
    const avgPrice = calculateAvgPrice(fills);
    const currentSlippage = calculateSlippage(fills[0].price, avgPrice);

    if (params.maxSlippagePct && currentSlippage > params.maxSlippagePct) {
      console.log(`Max slippage exceeded: ${currentSlippage}%`);
      break;
    }
  }

  return {
    fills,
    avgPrice: calculateAvgPrice(fills),
    slippage: calculateSlippage(fills[0].price, calculateAvgPrice(fills)),
  };
}

async function executeVWAP(
  params: ExecutionParams,
  wallet: any
): Promise<any> {
  // Volume-Weighted Average Price
  // Weight orders by typical volume profile

  // Get historical volume profile
  const volumeProfile = await getHistoricalVolumeProfile();

  // Split order proportional to volume
  const fills = [];

  for (const period of volumeProfile.periods) {
    const chunkSize = params.totalAmount * period.volumePct;
    const fill = await executeMarketOrder(chunkSize, wallet);
    fills.push(fill);

    await sleep(period.duration * 1000);
  }

  return {
    fills,
    avgPrice: calculateAvgPrice(fills),
    slippage: calculateSlippage(fills[0].price, calculateAvgPrice(fills)),
  };
}

function calculateAvgPrice(fills: any[]): number {
  const totalValue = fills.reduce((sum, f) => sum + f.price * f.amount, 0);
  const totalAmount = fills.reduce((sum, f) => sum + f.amount, 0);
  return totalValue / totalAmount;
}

function calculateSlippage(expectedPrice: number, actualPrice: number): number {
  return ((actualPrice - expectedPrice) / expectedPrice) * 100;
}
```

---

## 🎯 Success Metrics

After implementing all phases, measure:

1. **Backtest Performance**
   - Sharpe ratio > 1.5
   - Max drawdown < 20%
   - Win rate > 55%
   - Profit factor > 2.0

2. **Live Performance** (Paper Trading First!)
   - Positive alpha vs buy-and-hold
   - Consistent returns across market conditions
   - Low slippage (< 0.5% avg)

3. **User Metrics**
   - Agent profitability rate (% of agents profitable)
   - Average agent ROI
   - User retention (agents keep running)

---

## 📊 Implementation Priority

**Must Have (Phase 1-2):**
- On-chain metrics
- Social sentiment
- Mean reversion detection
- Trend strength analysis

**Should Have (Phase 3-4):**
- Enhanced AI prompts
- Multi-model ensemble
- Backtesting engine
- Walk-forward optimization

**Nice to Have (Phase 5):**
- TWAP/VWAP execution
- Order book analysis
- Support/resistance detection

---

## 🚨 Critical Success Factors

1. **Start with backtesting** - Don't deploy live without validation
2. **Paper trade first** - Validate in real-time before real money
3. **Start small** - Low risk profile, small capital
4. **Monitor closely** - Track all decisions, learn from failures
5. **Iterate fast** - Improve based on data, not intuition

---

**Next Steps:**
1. Choose Phase 1 feature to implement first (recommend: On-chain metrics)
2. Build integration into existing quantCore
3. Backtest on historical data
4. Paper trade for 2-4 weeks
5. Gradually scale up

Let's build genuinely profitable agents! 🚀
