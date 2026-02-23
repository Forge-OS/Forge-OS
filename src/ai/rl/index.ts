/**
 * Reinforcement Learning Module
 *
 * Autonomous AI trading agents for ForgeOS
 */

// Core components
export { TradingEnvironment } from './environment';
export { DQNAgent } from './dqnAgent';
export { NeuralNetwork } from './neuralNetwork';
export { ReplayBuffer } from './replayBuffer';
export { RLTrainer } from './trainer';

// Utilities
export { loadHistoricalData, saveToCache, trainTestSplit, walkForwardSplit, fetchHistoricalDataFromAPI } from './dataLoader';

// Examples
export { trainRLAgent, useTrainedAgent, quickDemo } from './example';

// Types
export type {
  TradingState,
  TradingAction,
  ActionResult,
  Reward,
  Experience,
  TrainingConfig,
  TrainingMetrics,
  NeuralNetworkConfig,
} from './types';
