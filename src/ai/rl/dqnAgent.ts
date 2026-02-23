/**
 * Deep Q-Network (DQN) Agent
 *
 * Reinforcement learning agent that learns optimal trading actions
 */

import type { TradingState, TradingAction, Experience, NeuralNetworkConfig } from './types';
import { NeuralNetwork } from './neuralNetwork';
import { ReplayBuffer } from './replayBuffer';

const ACTIONS: TradingAction[] = ['BUY', 'SELL', 'HOLD', 'CLOSE'];

export class DQNAgent {
  private qNetwork: NeuralNetwork;
  private targetNetwork: NeuralNetwork;
  private replayBuffer: ReplayBuffer;

  private epsilon: number;
  private epsilonDecay: number;
  private epsilonMin: number;
  private gamma: number;
  private trainStepCounter: number;
  private targetUpdateFreq: number;

  constructor(
    stateSize: number = 21,
    config?: Partial<NeuralNetworkConfig>
  ) {
    const networkConfig: NeuralNetworkConfig = {
      inputSize: stateSize,
      hiddenLayers: config?.hiddenLayers || [128, 128, 64],
      outputSize: ACTIONS.length,
      activation: 'relu',
      dropout: 0.1,
      learningRate: config?.learningRate || 0.0001,
    };

    this.qNetwork = new NeuralNetwork(networkConfig);
    this.targetNetwork = new NeuralNetwork(networkConfig);
    this.targetNetwork.setWeights(this.qNetwork.getWeights());

    this.replayBuffer = new ReplayBuffer(100000);

    // Hyperparameters
    this.epsilon = 1.0;           // Start with full exploration
    this.epsilonDecay = 0.995;
    this.epsilonMin = 0.01;
    this.gamma = 0.99;            // Discount factor
    this.trainStepCounter = 0;
    this.targetUpdateFreq = 1000;
  }

  /**
   * Select action using epsilon-greedy policy
   */
  selectAction(state: TradingState, stateEncoder: (s: TradingState) => number[]): TradingAction {
    // Exploration: Random action
    if (Math.random() < this.epsilon) {
      return this.randomAction(state);
    }

    // Exploitation: Best Q-value action
    const stateVector = stateEncoder(state);
    const qValues = this.qNetwork.predict(stateVector);

    // Filter invalid actions
    const validActions = this.getValidActions(state);
    const validQValues = qValues.map((q, i) =>
      validActions.includes(ACTIONS[i]) ? q : -Infinity
    );

    const actionIndex = this.argmax(validQValues);
    return ACTIONS[actionIndex];
  }

  /**
   * Get valid actions for current state
   */
  private getValidActions(state: TradingState): TradingAction[] {
    const valid: TradingAction[] = ['HOLD'];

    if (state.position === 0) {
      // No position: can buy
      valid.push('BUY');
    } else {
      // Has position: can sell or close
      valid.push('SELL', 'CLOSE');
    }

    return valid;
  }

  /**
   * Random action (exploration)
   */
  private randomAction(state: TradingState): TradingAction {
    const validActions = this.getValidActions(state);
    return validActions[Math.floor(Math.random() * validActions.length)];
  }

  /**
   * Store experience in replay buffer
   */
  remember(experience: Experience) {
    this.replayBuffer.add(experience);
  }

  /**
   * Train on batch from replay buffer
   */
  train(batchSize: number = 32): number {
    if (this.replayBuffer.size() < batchSize) {
      return 0; // Not enough experiences yet
    }

    // Sample random batch
    const batch = this.replayBuffer.sample(batchSize);

    // Prepare training data
    const states = batch.map(exp => exp.state);
    const nextStates = batch.map(exp => exp.nextState);

    // Get current Q-values
    const currentQs = states.map(s => this.qNetwork.predict(s));

    // Get next Q-values from target network
    const nextQs = nextStates.map(s => this.targetNetwork.predict(s));

    // Compute target Q-values using Bellman equation
    const targets: number[][] = [];
    let totalLoss = 0;

    for (let i = 0; i < batch.length; i++) {
      const target = [...currentQs[i]];

      if (batch[i].done) {
        // Terminal state: Q(s,a) = r
        target[batch[i].action] = batch[i].reward;
      } else {
        // Q(s,a) = r + γ * max(Q(s',a'))
        const maxNextQ = Math.max(...nextQs[i]);
        target[batch[i].action] = batch[i].reward + this.gamma * maxNextQ;
      }

      targets.push(target);

      // Calculate loss (MSE)
      const loss = Math.pow(target[batch[i].action] - currentQs[i][batch[i].action], 2);
      totalLoss += loss;
    }

    // Update Q-network
    this.qNetwork.train(states, targets);

    // Decay epsilon
    this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);

    // Update target network periodically
    this.trainStepCounter++;
    if (this.trainStepCounter % this.targetUpdateFreq === 0) {
      this.updateTargetNetwork();
    }

    return totalLoss / batch.length;
  }

  /**
   * Update target network weights from Q-network
   */
  private updateTargetNetwork() {
    this.targetNetwork.setWeights(this.qNetwork.getWeights());
    console.log('🎯 Target network updated');
  }

  /**
   * Utility: argmax
   */
  private argmax(arr: number[]): number {
    let maxIdx = 0;
    let maxVal = arr[0];

    for (let i = 1; i < arr.length; i++) {
      if (arr[i] > maxVal) {
        maxVal = arr[i];
        maxIdx = i;
      }
    }

    return maxIdx;
  }

  /**
   * Save model
   */
  save(): any {
    return {
      qNetwork: this.qNetwork.getWeights(),
      targetNetwork: this.targetNetwork.getWeights(),
      epsilon: this.epsilon,
      trainStepCounter: this.trainStepCounter,
    };
  }

  /**
   * Load model
   */
  load(data: any) {
    this.qNetwork.setWeights(data.qNetwork);
    this.targetNetwork.setWeights(data.targetNetwork);
    this.epsilon = data.epsilon;
    this.trainStepCounter = data.trainStepCounter;
  }

  /**
   * Get current epsilon
   */
  getEpsilon(): number {
    return this.epsilon;
  }

  /**
   * Set epsilon (for testing)
   */
  setEpsilon(value: number) {
    this.epsilon = Math.max(this.epsilonMin, Math.min(1.0, value));
  }
}
