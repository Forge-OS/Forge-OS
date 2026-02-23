/**
 * Reinforcement Learning Type Definitions
 *
 * Core types for autonomous AI trading agents
 */

export type TradingAction =
  | 'BUY'
  | 'SELL'
  | 'HOLD'
  | 'CLOSE';

export type TradingState = {
  // Market state
  price: number;
  volume: number;
  volatility: number;
  momentum: number;
  trend: number;

  // Position state
  position: number;              // -1 (short), 0 (flat), 1 (long)
  positionSize: number;          // Amount in KAS
  entryPrice: number;            // Entry price for current position
  unrealizedPnL: number;
  accountBalance: number;
  timeInPosition: number;        // Bars since entry

  // Technical indicators
  rsi: number;
  macd: number;
  bollingerPosition: number;     // -1 to 1
  emaFast: number;
  emaSlow: number;

  // Kaspa-specific
  daaScore: number;
  daaVelocity: number;

  // Context
  recentReturns: number[];       // Last 10 returns
  winRate: number;               // Recent win rate
  consecutiveLosses: number;

  // Risk metrics
  drawdown: number;
  sharpe: number;

  // Episode info
  step: number;
  episodeLength: number;
};

export type ActionResult = {
  nextState: TradingState;
  reward: number;
  done: boolean;
  info: {
    pnl: number;
    fee: number;
    slippage: number;
    portfolioValue: number;
    executionPrice: number;
    reason?: string;
  };
};

export type Reward = {
  pnl: number;
  riskAdjusted: number;
  survival: number;
  opportunity: number;
  total: number;
};

export type Experience = {
  state: number[];               // State vector
  action: number;                // Action index
  reward: number;
  nextState: number[];           // Next state vector
  done: boolean;
};

export type TrainingConfig = {
  episodes: number;
  maxStepsPerEpisode: number;
  batchSize: number;
  learningRate: number;
  gamma: number;                 // Discount factor
  epsilonStart: number;
  epsilonEnd: number;
  epsilonDecay: number;
  targetUpdateFreq: number;
  replayBufferSize: number;
  warmupSteps: number;
};

export type TrainingMetrics = {
  episode: number;
  totalReward: number;
  avgReward: number;
  epsilon: number;
  loss: number;
  finalBalance: number;
  sharpeRatio: number;
  winRate: number;
  maxDrawdown: number;
  totalTrades: number;
};

export type NeuralNetworkConfig = {
  inputSize: number;
  hiddenLayers: number[];
  outputSize: number;
  activation: 'relu' | 'tanh' | 'sigmoid';
  dropout: number;
  learningRate: number;
};
