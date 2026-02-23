/**
 * Trading Environment for Reinforcement Learning
 *
 * Simulates trading in Kaspa market with realistic execution
 */

import type { TradingState, TradingAction, ActionResult, Reward } from './types';
import type { QuantSnapshot } from '../../quant/quantCore';
import {
  rsi,
  macd,
  bollingerBands,
  ema,
  ewmaVolatility,
  pctChange,
  logReturns,
  mean,
  stddev,
  maxDrawdownPct,
  last,
  tail,
} from '../../quant/math';

export class TradingEnvironment {
  private historicalData: QuantSnapshot[];
  private currentIndex: number;
  private state: TradingState;
  private initialCapital: number;
  private tradingFee: number;
  private slippageRate: number;

  private tradeHistory: Array<{
    action: TradingAction;
    price: number;
    pnl: number;
    timestamp: number;
  }>;

  private accountHistory: number[];

  constructor(
    historicalData: QuantSnapshot[],
    initialCapital: number = 10000,
    tradingFee: number = 0.001,      // 0.1% fee
    slippageRate: number = 0.0005    // 0.05% slippage
  ) {
    this.historicalData = historicalData;
    this.initialCapital = initialCapital;
    this.tradingFee = tradingFee;
    this.slippageRate = slippageRate;
    this.currentIndex = 48; // Start after enough history for indicators
    this.tradeHistory = [];
    this.accountHistory = [initialCapital];

    this.state = this.buildInitialState();
  }

  /**
   * Reset environment for new episode
   */
  reset(): TradingState {
    this.currentIndex = 48;
    this.tradeHistory = [];
    this.accountHistory = [this.initialCapital];
    this.state = this.buildInitialState();
    return this.state;
  }

  /**
   * Execute action and return result
   */
  step(action: TradingAction): ActionResult {
    const currentPrice = this.getCurrentPrice();
    const previousState = { ...this.state };

    // Execute action
    const executionResult = this.executeAction(action, currentPrice);

    // Move to next time step
    this.currentIndex++;

    // Check if episode done
    const done =
      this.currentIndex >= this.historicalData.length - 1 ||
      this.state.accountBalance <= this.initialCapital * 0.1 || // 90% loss
      this.state.step >= 1000; // Max episode length

    // Build next state
    const nextState = done ? this.state : this.buildState();

    // Calculate reward
    const reward = this.calculateReward(previousState, nextState, executionResult);

    // Update state
    this.state = nextState;
    this.accountHistory.push(this.state.accountBalance + this.state.unrealizedPnL);

    return {
      nextState,
      reward: reward.total,
      done,
      info: {
        pnl: executionResult.pnl,
        fee: executionResult.fee,
        slippage: executionResult.slippage,
        portfolioValue: this.state.accountBalance + this.state.unrealizedPnL,
        executionPrice: executionResult.executionPrice,
        reason: executionResult.reason,
      },
    };
  }

  /**
   * Execute trading action
   */
  private executeAction(action: TradingAction, price: number) {
    let pnl = 0;
    let fee = 0;
    let slippage = 0;
    let executionPrice = price;
    let reason = '';

    const positionValue = Math.abs(this.state.positionSize * price);

    switch (action) {
      case 'BUY':
        if (this.state.position === 0) {
          // Open long position
          const availableCapital = this.state.accountBalance * 0.95; // Keep 5% reserve
          slippage = price * this.slippageRate;
          executionPrice = price + slippage;
          fee = availableCapital * this.tradingFee;

          const positionSize = (availableCapital - fee) / executionPrice;

          this.state.position = 1;
          this.state.positionSize = positionSize;
          this.state.entryPrice = executionPrice;
          this.state.accountBalance -= (positionSize * executionPrice + fee);
          this.state.timeInPosition = 0;

          reason = `Opened LONG ${positionSize.toFixed(2)} KAS @ ${executionPrice.toFixed(4)}`;
        } else {
          reason = 'Already in position, cannot BUY';
        }
        break;

      case 'SELL':
        if (this.state.position === 1) {
          // Close long position
          slippage = price * this.slippageRate;
          executionPrice = price - slippage;
          fee = positionValue * this.tradingFee;

          pnl = (executionPrice - this.state.entryPrice) * this.state.positionSize - fee;

          this.state.accountBalance += (this.state.positionSize * executionPrice - fee);
          this.state.unrealizedPnL = 0;
          this.state.position = 0;
          this.state.positionSize = 0;
          this.state.entryPrice = 0;
          this.state.timeInPosition = 0;

          this.tradeHistory.push({
            action: 'SELL',
            price: executionPrice,
            pnl,
            timestamp: this.historicalData[this.currentIndex].ts,
          });

          reason = `Closed LONG, P&L: ${pnl.toFixed(2)} KAS`;
        } else if (this.state.position === 0) {
          // Could implement shorting here
          reason = 'No position to SELL';
        }
        break;

      case 'CLOSE':
        if (this.state.position !== 0) {
          // Close any position
          slippage = price * this.slippageRate;
          executionPrice = this.state.position === 1 ? price - slippage : price + slippage;
          fee = positionValue * this.tradingFee;

          if (this.state.position === 1) {
            pnl = (executionPrice - this.state.entryPrice) * this.state.positionSize - fee;
            this.state.accountBalance += (this.state.positionSize * executionPrice - fee);
          }

          this.state.unrealizedPnL = 0;
          this.state.position = 0;
          this.state.positionSize = 0;
          this.state.entryPrice = 0;
          this.state.timeInPosition = 0;

          this.tradeHistory.push({
            action: 'CLOSE',
            price: executionPrice,
            pnl,
            timestamp: this.historicalData[this.currentIndex].ts,
          });

          reason = `Closed position, P&L: ${pnl.toFixed(2)} KAS`;
        }
        break;

      case 'HOLD':
        // Update unrealized P&L
        if (this.state.position === 1) {
          this.state.unrealizedPnL = (price - this.state.entryPrice) * this.state.positionSize;
          this.state.timeInPosition++;
        }
        reason = 'Holding position';
        break;
    }

    return { pnl, fee, slippage, executionPrice, reason };
  }

  /**
   * Calculate multi-component reward
   */
  private calculateReward(
    previousState: TradingState,
    nextState: TradingState,
    executionResult: any
  ): Reward {
    // 1. P&L reward (primary)
    const pnlReward = executionResult.pnl;

    // 2. Risk-adjusted reward (Sharpe-like)
    const returns = this.accountHistory.map((v, i, arr) =>
      i > 0 ? (v - arr[i - 1]) / arr[i - 1] : 0
    ).filter(r => r !== 0);

    const avgReturn = mean(returns);
    const returnStd = stddev(returns) || 1;
    const sharpe = avgReturn / returnStd;
    const riskAdjustedReward = sharpe * 0.1;

    // 3. Survival penalty (avoid blowing up)
    const accountRatio = nextState.accountBalance / this.initialCapital;
    let survivalPenalty = 0;

    if (accountRatio < 0.5) survivalPenalty = -5;
    if (accountRatio < 0.3) survivalPenalty = -15;
    if (accountRatio < 0.1) survivalPenalty = -50;

    // 4. Opportunity cost (penalize holding cash in trending market)
    const marketReturn = pctChange(
      this.historicalData.slice(0, this.currentIndex).map(d => d.priceUsd),
      5
    );

    let opportunityCost = 0;
    if (nextState.position === 0 && Math.abs(marketReturn) > 0.02) {
      // Missing a >2% move
      opportunityCost = -Math.abs(marketReturn) * 2;
    }

    // 5. Holding time penalty (don't hold losing positions forever)
    let holdingPenalty = 0;
    if (nextState.position !== 0 && nextState.unrealizedPnL < 0) {
      holdingPenalty = -0.01 * nextState.timeInPosition;
    }

    const total =
      pnlReward +
      riskAdjustedReward +
      survivalPenalty +
      opportunityCost +
      holdingPenalty;

    return {
      pnl: pnlReward,
      riskAdjusted: riskAdjustedReward,
      survival: survivalPenalty,
      opportunity: opportunityCost,
      total,
    };
  }

  /**
   * Build initial state
   */
  private buildInitialState(): TradingState {
    return {
      ...this.buildState(),
      position: 0,
      positionSize: 0,
      entryPrice: 0,
      unrealizedPnL: 0,
      accountBalance: this.initialCapital,
      timeInPosition: 0,
      consecutiveLosses: 0,
      step: 0,
    };
  }

  /**
   * Build current state from market data
   */
  private buildState(): TradingState {
    const history = this.historicalData.slice(0, this.currentIndex + 1);
    const prices = history.map(d => d.priceUsd);
    const daaSeries = history.map(d => d.daaScore);

    // Technical indicators
    const rsiValue = rsi(prices, 14);
    const macdData = macd(prices, 12, 26, 9);
    const bb = bollingerBands(prices, 20, 2);
    const emaFast = ema(prices, 12);
    const emaSlow = ema(prices, 26);

    const currentPrice = this.getCurrentPrice();
    const bollingerPosition = (currentPrice - bb.middle) / (bb.upper - bb.middle);

    // Momentum & volatility
    const returns = logReturns(prices);
    const recentReturns = tail(returns, 10);
    const volatility = ewmaVolatility(recentReturns, 0.94);
    const momentum = pctChange(prices, 5);
    const trend = emaFast > emaSlow ? 1 : -1;

    // DAA metrics
    const daaVelocity = daaSeries.length > 1
      ? daaSeries[daaSeries.length - 1] - daaSeries[daaSeries.length - 2]
      : 0;

    // Risk metrics
    const accountValues = this.accountHistory.slice(-48);
    const drawdown = maxDrawdownPct(accountValues);
    const accountReturns = accountValues.map((v, i, arr) =>
      i > 0 ? (v - arr[i - 1]) / arr[i - 1] : 0
    ).filter(r => r !== 0);
    const sharpe = accountReturns.length > 0
      ? mean(accountReturns) / (stddev(accountReturns) || 1)
      : 0;

    // Win rate
    const recentTrades = this.tradeHistory.slice(-20);
    const wins = recentTrades.filter(t => t.pnl > 0).length;
    const winRate = recentTrades.length > 0 ? wins / recentTrades.length : 0.5;

    // Consecutive losses
    let consecutiveLosses = 0;
    for (let i = this.tradeHistory.length - 1; i >= 0; i--) {
      if (this.tradeHistory[i].pnl < 0) {
        consecutiveLosses++;
      } else {
        break;
      }
    }

    return {
      // Market
      price: currentPrice,
      volume: history[history.length - 1]?.walletKas || 0,
      volatility,
      momentum,
      trend,

      // Position (preserved from previous state)
      position: this.state?.position || 0,
      positionSize: this.state?.positionSize || 0,
      entryPrice: this.state?.entryPrice || 0,
      unrealizedPnL: this.state?.unrealizedPnL || 0,
      accountBalance: this.state?.accountBalance || this.initialCapital,
      timeInPosition: this.state?.timeInPosition || 0,

      // Technical
      rsi: rsiValue,
      macd: macdData.histogram,
      bollingerPosition,
      emaFast,
      emaSlow,

      // Kaspa
      daaScore: last(daaSeries) || 0,
      daaVelocity,

      // Context
      recentReturns,
      winRate,
      consecutiveLosses,

      // Risk
      drawdown,
      sharpe,

      // Episode
      step: this.state?.step + 1 || 0,
      episodeLength: this.historicalData.length - 48,
    };
  }

  /**
   * Encode state to vector for neural network
   */
  encodeState(state: TradingState): number[] {
    return [
      // Normalize all features to [-1, 1] or [0, 1]

      // Market (5 features)
      (state.price - 0.1) / 0.1,              // Normalized price
      state.volatility * 100,                  // Volatility %
      state.momentum,                          // Already -1 to 1
      state.trend,                             // -1 or 1

      // Position (4 features)
      state.position,                          // -1, 0, or 1
      Math.tanh(state.unrealizedPnL / 100),   // Normalized unrealized P&L
      Math.tanh(state.timeInPosition / 50),   // Normalized time in position
      state.accountBalance / this.initialCapital, // Account ratio

      // Technical (5 features)
      (state.rsi - 50) / 50,                  // Normalized RSI
      Math.tanh(state.macd * 10),             // Normalized MACD
      state.bollingerPosition,                 // Already -1 to 1
      (state.emaFast - state.emaSlow) / state.price, // EMA diff %

      // Kaspa (2 features)
      state.daaScore / 100000000,             // Normalized DAA
      Math.tanh(state.daaVelocity / 1000),    // Normalized DAA velocity

      // Context (3 features)
      state.winRate,                           // 0 to 1
      Math.tanh(state.consecutiveLosses / 3), // Normalized streak
      mean(state.recentReturns) * 100,        // Avg recent return %

      // Risk (2 features)
      -state.drawdown,                         // Drawdown (negative)
      Math.tanh(state.sharpe),                // Normalized Sharpe

      // Total: 21 features
    ];
  }

  /**
   * Get current market price
   */
  private getCurrentPrice(): number {
    return this.historicalData[this.currentIndex]?.priceUsd || 0;
  }

  /**
   * Get current state
   */
  getState(): TradingState {
    return this.state;
  }

  /**
   * Get performance metrics
   */
  getMetrics() {
    const finalValue = this.state.accountBalance + this.state.unrealizedPnL;
    const totalReturn = ((finalValue - this.initialCapital) / this.initialCapital) * 100;

    const returns = this.accountHistory.map((v, i, arr) =>
      i > 0 ? (v - arr[i - 1]) / arr[i - 1] : 0
    ).filter(r => r !== 0);

    const winningTrades = this.tradeHistory.filter(t => t.pnl > 0);
    const losingTrades = this.tradeHistory.filter(t => t.pnl < 0);

    return {
      totalReturn,
      finalBalance: finalValue,
      totalTrades: this.tradeHistory.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: this.tradeHistory.length > 0
        ? winningTrades.length / this.tradeHistory.length
        : 0,
      maxDrawdown: maxDrawdownPct(this.accountHistory),
      sharpeRatio: returns.length > 0
        ? mean(returns) / (stddev(returns) || 1) * Math.sqrt(252)
        : 0,
      avgWin: winningTrades.length > 0
        ? mean(winningTrades.map(t => t.pnl))
        : 0,
      avgLoss: losingTrades.length > 0
        ? mean(losingTrades.map(t => Math.abs(t.pnl)))
        : 0,
    };
  }
}
