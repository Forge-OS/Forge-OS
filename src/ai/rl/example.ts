/**
 * Example: Train and Test RL Agent
 *
 * This shows how to use the RL system
 */

import { RLTrainer } from './trainer';
import { loadHistoricalData, trainTestSplit, saveToCache } from './dataLoader';
import type { TrainingMetrics } from './types';

/**
 * Main training example
 */
export async function trainRLAgent() {
  console.log('🧠 RL Agent Training Example\n');

  // 1. Load historical data
  console.log('Step 1: Loading data...');
  const allData = await loadHistoricalData();

  if (allData.length < 100) {
    console.error('❌ Not enough data. Need at least 100 data points.');
    return;
  }

  // 2. Split into train/test
  const { train, test } = trainTestSplit(allData, 0.8);
  console.log(`  Train: ${train.length} points`);
  console.log(`  Test: ${test.length} points\n`);

  // 3. Create trainer
  console.log('Step 2: Creating trainer...');
  const trainer = new RLTrainer(21, {
    episodes: 200,              // Fewer episodes for demo
    batchSize: 32,
    learningRate: 0.0001,
    epsilonDecay: 0.995,
    warmupSteps: 500,
  });

  // 4. Train
  console.log('\nStep 3: Training agent...\n');

  const metrics: TrainingMetrics[] = [];

  await trainer.train(train, (m) => {
    metrics.push(m);

    // Log every 20 episodes
    if (m.episode % 20 === 0) {
      console.log(`\n📊 Episode ${m.episode} Summary:`);
      console.log(`  Avg Reward (last 100): ${m.avgReward.toFixed(2)}`);
      console.log(`  Epsilon: ${m.epsilon.toFixed(3)}`);
      console.log(`  Win Rate: ${(m.winRate * 100).toFixed(1)}%`);
      console.log(`  Sharpe: ${m.sharpeRatio.toFixed(2)}`);
    }
  });

  // 5. Test on unseen data
  console.log('\nStep 4: Testing on unseen data...\n');
  const testResults = await trainer.test(test, 0.0); // No exploration during test

  // 6. Compare to buy-and-hold
  const buyHoldReturn = ((test[test.length - 1].priceUsd - test[0].priceUsd) / test[0].priceUsd) * 100;

  console.log('\n' + '='.repeat(50));
  console.log('FINAL RESULTS');
  console.log('='.repeat(50));
  console.log(`RL Agent Return: ${testResults.metrics.totalReturn.toFixed(2)}%`);
  console.log(`Buy & Hold Return: ${buyHoldReturn.toFixed(2)}%`);
  console.log(`Alpha: ${(testResults.metrics.totalReturn - buyHoldReturn).toFixed(2)}%`);
  console.log(`Sharpe Ratio: ${testResults.metrics.sharpeRatio.toFixed(2)}`);
  console.log(`Win Rate: ${(testResults.metrics.winRate * 100).toFixed(1)}%`);
  console.log(`Max Drawdown: ${(testResults.metrics.maxDrawdown * 100).toFixed(1)}%`);
  console.log(`Total Trades: ${testResults.metrics.totalTrades}`);
  console.log('='.repeat(50) + '\n');

  // 7. Save final model
  console.log('Step 5: Saving model...');
  trainer.saveCheckpoint('final_model');

  // Return results
  return {
    trainMetrics: metrics,
    testResults,
    buyHoldReturn,
    alpha: testResults.metrics.totalReturn - buyHoldReturn,
  };
}

/**
 * Load and use a trained agent
 */
export async function useTrainedAgent() {
  console.log('🤖 Loading trained agent...\n');

  const trainer = new RLTrainer();

  // Load checkpoint
  const loaded = trainer.loadCheckpoint('final_model');

  if (!loaded) {
    console.error('❌ No trained model found. Run trainRLAgent() first.');
    return;
  }

  // Load recent data
  const recentData = await loadHistoricalData();
  const last500 = recentData.slice(-500);

  // Test
  const results = await trainer.test(last500, 0.0);

  console.log('✅ Agent loaded and tested successfully!');

  return results;
}

/**
 * Quick demo (runs in browser console or Node)
 */
export async function quickDemo() {
  console.log('🚀 Quick RL Demo\n');
  console.log('This will train an agent on 2000 hours of simulated data.\n');

  const results = await trainRLAgent();

  if (results) {
    console.log('\n✅ Demo complete!');
    console.log('Next steps:');
    console.log('  1. Run useTrainedAgent() to use the model');
    console.log('  2. Integrate with dashboard');
    console.log('  3. Train on real historical data');
  }

  return results;
}

// Auto-run demo if executed directly
if (typeof window !== 'undefined') {
  // Browser environment
  (window as any).trainRLAgent = trainRLAgent;
  (window as any).useTrainedAgent = useTrainedAgent;
  (window as any).quickDemo = quickDemo;

  console.log('💡 RL functions available in console:');
  console.log('  - quickDemo()');
  console.log('  - trainRLAgent()');
  console.log('  - useTrainedAgent()');
}
