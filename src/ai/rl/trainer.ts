/**
 * RL Agent Trainer
 *
 * Trains DQN agent on historical trading data
 */

import type { TradingAction, TrainingConfig, TrainingMetrics, Experience } from './types';
import type { QuantSnapshot } from '../../quant/quantCore';
import { TradingEnvironment } from './environment';
import { DQNAgent } from './dqnAgent';
import { mean, stddev } from '../../quant/math';

export class RLTrainer {
  private agent: DQNAgent;
  private config: TrainingConfig;

  constructor(
    stateSize: number = 21,
    config?: Partial<TrainingConfig>
  ) {
    this.agent = new DQNAgent(stateSize);

    this.config = {
      episodes: config?.episodes || 500,
      maxStepsPerEpisode: config?.maxStepsPerEpisode || 1000,
      batchSize: config?.batchSize || 32,
      learningRate: config?.learningRate || 0.0001,
      gamma: config?.gamma || 0.99,
      epsilonStart: config?.epsilonStart || 1.0,
      epsilonEnd: config?.epsilonEnd || 0.01,
      epsilonDecay: config?.epsilonDecay || 0.995,
      targetUpdateFreq: config?.targetUpdateFreq || 1000,
      replayBufferSize: config?.replayBufferSize || 100000,
      warmupSteps: config?.warmupSteps || 1000,
    };
  }

  /**
   * Train agent on historical data
   */
  async train(
    historicalData: QuantSnapshot[],
    progressCallback?: (metrics: TrainingMetrics) => void
  ): Promise<TrainingMetrics[]> {
    console.log('🚀 Starting RL training...');
    console.log(`Episodes: ${this.config.episodes}`);
    console.log(`Historical data points: ${historicalData.length}`);

    const allMetrics: TrainingMetrics[] = [];
    const episodeRewards: number[] = [];

    for (let episode = 0; episode < this.config.episodes; episode++) {
      const env = new TradingEnvironment(historicalData);
      let state = env.reset();
      let totalReward = 0;
      let totalLoss = 0;
      let steps = 0;
      let done = false;
      let lossCount = 0;

      while (!done && steps < this.config.maxStepsPerEpisode) {
        // Select action
        const action = this.agent.selectAction(state, s => env.encodeState(s));

        // Execute action
        const result = env.step(action);

        // Store experience
        const experience: Experience = {
          state: env.encodeState(state),
          action: this.actionToIndex(action),
          reward: result.reward,
          nextState: env.encodeState(result.nextState),
          done: result.done,
        };

        this.agent.remember(experience);

        // Train after warmup
        if (this.agent['replayBuffer'].size() > this.config.warmupSteps) {
          if (steps % 4 === 0) {  // Train every 4 steps
            const loss = this.agent.train(this.config.batchSize);
            totalLoss += loss;
            lossCount++;
          }
        }

        totalReward += result.reward;
        state = result.nextState;
        done = result.done;
        steps++;
      }

      // Episode complete
      episodeRewards.push(totalReward);

      // Calculate metrics
      const envMetrics = env.getMetrics();
      const recentRewards = episodeRewards.slice(-100);
      const avgReward = mean(recentRewards);

      const metrics: TrainingMetrics = {
        episode,
        totalReward,
        avgReward,
        epsilon: this.agent.getEpsilon(),
        loss: lossCount > 0 ? totalLoss / lossCount : 0,
        finalBalance: envMetrics.finalBalance,
        sharpeRatio: envMetrics.sharpeRatio,
        winRate: envMetrics.winRate,
        maxDrawdown: envMetrics.maxDrawdown,
        totalTrades: envMetrics.totalTrades,
      };

      allMetrics.push(metrics);

      // Progress logging
      if (episode % 10 === 0) {
        console.log(`Episode ${episode}/${this.config.episodes}:`);
        console.log(`  Reward: ${totalReward.toFixed(2)} (avg: ${avgReward.toFixed(2)})`);
        console.log(`  Epsilon: ${metrics.epsilon.toFixed(3)}`);
        console.log(`  Balance: $${envMetrics.finalBalance.toFixed(2)}`);
        console.log(`  Sharpe: ${envMetrics.sharpeRatio.toFixed(2)}`);
        console.log(`  Win Rate: ${(envMetrics.winRate * 100).toFixed(1)}%`);
        console.log(`  Trades: ${envMetrics.totalTrades}`);
      }

      // Callback
      if (progressCallback) {
        progressCallback(metrics);
      }

      // Save checkpoint every 50 episodes
      if (episode > 0 && episode % 50 === 0) {
        this.saveCheckpoint(`checkpoint_ep${episode}`);
      }
    }

    console.log('✅ Training complete!');
    this.printTrainingSummary(allMetrics);

    return allMetrics;
  }

  /**
   * Test trained agent
   */
  async test(
    historicalData: QuantSnapshot[],
    epsilon: number = 0.0  // No exploration during testing
  ): Promise<any> {
    console.log('🧪 Testing trained agent...');

    const originalEpsilon = this.agent.getEpsilon();
    this.agent.setEpsilon(epsilon);

    const env = new TradingEnvironment(historicalData);
    let state = env.reset();
    let done = false;
    let totalReward = 0;
    const actions: TradingAction[] = [];

    while (!done) {
      const action = this.agent.selectAction(state, s => env.encodeState(s));
      actions.push(action);

      const result = env.step(action);

      totalReward += result.reward;
      state = result.nextState;
      done = result.done;
    }

    const metrics = env.getMetrics();

    // Restore original epsilon
    this.agent.setEpsilon(originalEpsilon);

    console.log('📊 Test Results:');
    console.log(`  Total Reward: ${totalReward.toFixed(2)}`);
    console.log(`  Final Balance: $${metrics.finalBalance.toFixed(2)}`);
    console.log(`  Total Return: ${metrics.totalReturn.toFixed(2)}%`);
    console.log(`  Sharpe Ratio: ${metrics.sharpeRatio.toFixed(2)}`);
    console.log(`  Win Rate: ${(metrics.winRate * 100).toFixed(1)}%`);
    console.log(`  Max Drawdown: ${(metrics.maxDrawdown * 100).toFixed(1)}%`);
    console.log(`  Total Trades: ${metrics.totalTrades}`);

    return {
      totalReward,
      metrics,
      actions,
    };
  }

  /**
   * Save model checkpoint
   */
  saveCheckpoint(name: string) {
    const checkpoint = {
      agent: this.agent.save(),
      config: this.config,
      timestamp: Date.now(),
    };

    // In browser: save to localStorage
    // In Node: save to file
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`rl_checkpoint_${name}`, JSON.stringify(checkpoint));
      console.log(`💾 Checkpoint saved: ${name}`);
    }

    return checkpoint;
  }

  /**
   * Load model checkpoint
   */
  loadCheckpoint(name: string) {
    if (typeof localStorage !== 'undefined') {
      const data = localStorage.getItem(`rl_checkpoint_${name}`);
      if (data) {
        const checkpoint = JSON.parse(data);
        this.agent.load(checkpoint.agent);
        this.config = checkpoint.config;
        console.log(`📂 Checkpoint loaded: ${name}`);
        return true;
      }
    }
    return false;
  }

  /**
   * Get trained agent
   */
  getAgent(): DQNAgent {
    return this.agent;
  }

  /**
   * Print training summary
   */
  private printTrainingSummary(metrics: TrainingMetrics[]) {
    const finalMetrics = metrics[metrics.length - 1];
    const first100 = metrics.slice(0, Math.min(100, metrics.length));
    const last100 = metrics.slice(-100);

    const first100AvgReward = mean(first100.map(m => m.totalReward));
    const last100AvgReward = mean(last100.map(m => m.totalReward));

    console.log('\n📈 Training Summary:');
    console.log('  First 100 episodes avg reward:', first100AvgReward.toFixed(2));
    console.log('  Last 100 episodes avg reward:', last100AvgReward.toFixed(2));
    console.log('  Improvement:', ((last100AvgReward - first100AvgReward) / Math.abs(first100AvgReward) * 100).toFixed(1) + '%');
    console.log('  Final epsilon:', finalMetrics.epsilon.toFixed(3));
    console.log('  Final Sharpe:', finalMetrics.sharpeRatio.toFixed(2));
    console.log('  Final win rate:', (finalMetrics.winRate * 100).toFixed(1) + '%');
  }

  /**
   * Convert action to index
   */
  private actionToIndex(action: TradingAction): number {
    const actions: TradingAction[] = ['BUY', 'SELL', 'HOLD', 'CLOSE'];
    return actions.indexOf(action);
  }
}
