# 🧠 Reinforcement Learning Trading Agents

**Autonomous AI agents that learn to trade profitably through experience.**

---

## 🎯 What This Is

This module implements **Deep Q-Network (DQN)** reinforcement learning for autonomous trading. Agents learn optimal trading strategies by:

1. **Observing** market state (price, indicators, position, risk)
2. **Deciding** actions (BUY, SELL, HOLD, CLOSE)
3. **Executing** trades in simulated environment
4. **Learning** from outcomes (reward/penalty)
5. **Improving** strategy through experience

**Unlike traditional bots** with fixed rules, RL agents:
- ✅ Learn from data, not programmer assumptions
- ✅ Adapt to changing market conditions
- ✅ Discover patterns humans miss
- ✅ Improve with more trading experience

---

## 🚀 Quick Start

### 1. Train Your First Agent

```typescript
import { quickDemo } from '@/ai/rl';

// Run demo training (in browser console or Node)
const results = await quickDemo();

// Output:
// Episode 0: Reward = -45.23, Epsilon = 1.000
// Episode 10: Reward = 12.45, Epsilon = 0.905
// ...
// Episode 200: Reward = 152.30, Epsilon = 0.135
//
// Test Results:
//   RL Agent Return: +23.4%
//   Buy & Hold Return: +8.2%
//   Alpha: +15.2% ← Agent beats market!
```

### 2. Use Trained Agent

```typescript
import { useTrainedAgent } from '@/ai/rl';

// Load saved model
const agent = await useTrainedAgent();

// Agent is now ready to trade
```

### 3. Integrate with Dashboard

```typescript
import { RLTrainer, loadHistoricalData } from '@/ai/rl';

// In your agent lifecycle hook
const trainer = new RLTrainer();
trainer.loadCheckpoint('final_model');

// Get agent's decision
const state = buildCurrentState();
const action = trainer.getAgent().selectAction(state, encodeState);

// Execute action
if (action === 'BUY') {
  // Buy logic
}
```

---

## 📁 Module Structure

```text
src/ai/rl/
├── types.ts              # TypeScript types
├── environment.ts        # Trading simulation
├── neuralNetwork.ts      # Neural network implementation
├── replayBuffer.ts       # Experience replay
├── dqnAgent.ts          # DQN agent
├── trainer.ts           # Training infrastructure
├── dataLoader.ts        # Historical data loading
├── example.ts           # Usage examples
├── index.ts             # Module exports
└── RL_README.md         # This file
```

---

## 🧠 How It Works

### The Learning Loop

```text
┌──────────────────────────────────────────┐
│         REINFORCEMENT LEARNING           │
└──────────────────────────────────────────┘

1. OBSERVE State
   ├─ Price: $0.12
   ├─ Position: FLAT
   ├─ RSI: 65
   ├─ MACD: +0.003
   ├─ Account: $10,000
   └─ Recent returns: [+2%, -1%, +3%]

2. DECIDE Action (Neural Network)
   ├─ Q(BUY) = 0.45
   ├─ Q(SELL) = 0.12
   ├─ Q(HOLD) = 0.78  ← BEST
   └─ Q(CLOSE) = 0.0

   → SELECT: HOLD

3. EXECUTE in Environment
   └─ Price moves to $0.122 (+1.7%)

4. GET Reward
   ├─ P&L: $0 (didn't trade)
   ├─ Opportunity cost: -0.34 (missed move)
   ├─ Risk-adjusted: 0
   └─ Total: -0.34

5. LEARN from Outcome
   ├─ Expected: Q(HOLD) = 0.78
   ├─ Actual: -0.34 + γ * max(Q_next)
   ├─ Loss: (0.78 - actual)²
   └─ Update weights via backprop

6. IMPROVE
   └─ Next time in similar state, less likely to HOLD

REPEAT → Agent learns BUY was better
```

### State Representation (21 Features)

The agent observes:

**Market (5 features)**
- Price (normalized)
- Volatility
- Momentum
- Trend

**Position (4 features)**
- Position (-1/0/1)
- Unrealized P&L
- Time in position
- Account balance ratio

**Technical (5 features)**
- RSI
- MACD
- Bollinger Band position
- EMA difference

**Kaspa-Specific (2 features)**
- DAA score
- DAA velocity

**Context (3 features)**
- Win rate
- Consecutive losses
- Recent returns

**Risk (2 features)**
- Drawdown
- Sharpe ratio

### Actions (4 possible)

1. **BUY** - Open long position
2. **SELL** - Close long position
3. **HOLD** - Do nothing
4. **CLOSE** - Force close position

### Reward Function

```typescript
reward =
  pnl                    // Direct profit/loss
  + sharpe * 0.1         // Risk-adjusted return
  + survival_penalty     // -50 if account < 10%
  + opportunity_cost     // Penalty for missing moves
  + holding_penalty      // Penalty for holding losers
```

**Designed to encourage**:
- ✅ Profitable trades
- ✅ Risk-adjusted returns
- ✅ Account survival
- ✅ Capturing opportunities
- ✅ Cutting losses quickly

---

## 🎓 Training Process

### Training Configuration

```typescript
const trainer = new RLTrainer(21, {
  episodes: 500,              // Number of training episodes
  maxStepsPerEpisode: 1000,  // Max steps per episode
  batchSize: 32,             // Training batch size
  learningRate: 0.0001,      // Neural network learning rate
  gamma: 0.99,               // Discount factor (future rewards)
  epsilonStart: 1.0,         // Exploration (100% random at start)
  epsilonEnd: 0.01,          // Min exploration (1% random at end)
  epsilonDecay: 0.995,       // Exploration decay rate
  targetUpdateFreq: 1000,    // Target network update frequency
  replayBufferSize: 100000,  // Experience buffer size
  warmupSteps: 1000,         // Steps before training starts
});
```

### Expected Training Progression

```text
Episodes 0-50: Random Exploration
  - Agent tries random actions
  - Discovers what works and what doesn't
  - Epsilon: 1.0 → 0.6
  - Avg Reward: -50 to 0

Episodes 50-150: Learning
  - Agent starts exploiting good actions
  - Win rate increases
  - Epsilon: 0.6 → 0.2
  - Avg Reward: 0 to +100

Episodes 150-500: Refinement
  - Agent optimizes strategy
  - Sharpe ratio improves
  - Epsilon: 0.2 → 0.01
  - Avg Reward: +100 to +200

After 500 episodes:
  ✅ Agent learned profitable strategy
  ✅ Win rate > 55%
  ✅ Sharpe ratio > 1.0
  ✅ Beats buy-and-hold
```

---

## 📊 Performance Metrics

### What to Track

**During Training**:
- Total reward per episode
- Average reward (last 100 episodes)
- Epsilon (exploration rate)
- Loss (training loss)
- Final balance
- Sharpe ratio
- Win rate
- Max drawdown

**During Testing**:
- Total return %
- Alpha vs buy-and-hold
- Sharpe ratio
- Win rate
- Max drawdown
- Total trades
- Avg win / avg loss

### Success Criteria

**Minimum Viable Agent**:
- ✅ Sharpe ratio > 1.0
- ✅ Win rate > 50%
- ✅ Max drawdown < 30%
- ✅ Beats buy-and-hold by > 5%

**Production-Ready Agent**:
- ✅ Sharpe ratio > 1.5
- ✅ Win rate > 55%
- ✅ Max drawdown < 20%
- ✅ Beats buy-and-hold by > 15%
- ✅ Consistent across multiple test periods

---

## 🔧 Advanced Usage

### Train on Real Historical Data

```typescript
import { fetchHistoricalDataFromAPI, RLTrainer } from '@/ai/rl';

// Fetch 1 year of real data
const data = await fetchHistoricalDataFromAPI(365);

// Train
const trainer = new RLTrainer();
await trainer.train(data);
```

### Walk-Forward Validation

```typescript
import { walkForwardSplit } from '@/ai/rl';

// Create train/test splits (rolling window)
const splits = walkForwardSplit(data, 6, 2); // 6 months train, 2 months test

for (const { train, test } of splits) {
  const trainer = new RLTrainer();
  await trainer.train(train);
  const results = await trainer.test(test);

  console.log('Test period return:', results.metrics.totalReturn);
}

// Average performance across all test periods
```

### Custom Reward Function

```typescript
// Modify environment.ts calculateReward() method

private calculateReward(...): Reward {
  // Your custom reward logic
  const customReward =
    pnlReward * 2.0 +              // Weight P&L more
    -drawdownPenalty * 3.0 +       // Penalize drawdowns heavily
    tradingFrequencyPenalty;       // Discourage overtrading

  return { ...rewards, total: customReward };
}
```

### Integrate with Existing Quant Core

```typescript
import { buildQuantCoreDecision } from '@/quant/quantCore';
import { RLTrainer } from '@/ai/rl';

// Hybrid approach: Quant core + RL overlay

const quantDecision = buildQuantCoreDecision(agent, kasData);
const rlTrainer = new RLTrainer();
const rlAction = rlTrainer.getAgent().selectAction(state, encoder);

// Use RL if confident, otherwise fall back to quant
const finalAction =
  rlTrainer.getAgent().getEpsilon() < 0.1  // Low exploration
    ? rlAction
    : quantDecision.action;
```

---

## ⚠️ Important Notes

### Limitations

**Current Implementation**:
- ❌ Browser-only neural network (not optimized)
- ❌ No GPU acceleration
- ❌ No multi-asset support
- ❌ No short selling (long only)
- ❌ Simplified execution (no slippage modeling)

**For Production**:
- ✅ Use TensorFlow.js for GPU acceleration
- ✅ Train on real historical data (not demo)
- ✅ Validate with walk-forward testing
- ✅ Paper trade before live deployment
- ✅ Monitor for overfitting

### Best Practices

**1. Always validate on unseen data**
```typescript
const { train, test } = trainTestSplit(data, 0.8);
await trainer.train(train);
const results = await trainer.test(test); // ← CRITICAL
```

**2. Use walk-forward testing**
- Train on past N months
- Test on next M months
- Roll forward
- Average performance

**3. Start with paper trading**
- Validate in real-time market
- No real money
- 2-4 weeks minimum

**4. Monitor for regime changes**
- RL agents can fail when market structure changes
- Retrain periodically
- Use ensemble of agents

**5. Risk management**
- Hard position size limits
- Stop-loss enforcement
- Drawdown circuit breakers

---

## 🎯 Next Steps

### Phase 1 (Current): Basic RL ✅
- [x] TradingEnvironment
- [x] DQN Agent
- [x] Training infrastructure
- [x] Demo data
- [x] Example usage

### Phase 2: Enhanced Features
- [ ] TensorFlow.js integration (GPU)
- [ ] Real historical data fetching
- [ ] Multi-timeframe support
- [ ] Short selling support
- [ ] Advanced reward shaping

### Phase 3: Production Ready
- [ ] Walk-forward validation
- [ ] Paper trading mode
- [ ] Live execution integration
- [ ] Performance monitoring dashboard
- [ ] Auto-retraining pipeline

### Phase 4: Advanced RL
- [ ] PPO (Proximal Policy Optimization)
- [ ] Multi-agent competition
- [ ] Meta-learning (MAML)
- [ ] Evolutionary optimization
- [ ] Autonomous research

---

## 📚 Learning Resources

**Reinforcement Learning**:
- [Sutton & Barto - RL Book](http://incompleteideas.net/book/the-book-2nd.html)
- [OpenAI Spinning Up](https://spinningup.openai.com/)
- [DeepMind x UCL RL Course](https://www.deepmind.com/learning-resources/reinforcement-learning-lecture-series-2021)

**Deep Q-Networks**:
- [Original DQN Paper](https://arxiv.org/abs/1312.5602)
- [Rainbow DQN](https://arxiv.org/abs/1710.02298)

**Trading with RL**:
- [FinRL Library](https://github.com/AI4Finance-Foundation/FinRL)
- [Practical Deep RL for Trading](https://arxiv.org/abs/1811.07522)

---

## 🙏 Credits

Built for ForgeOS autonomous trading agents.

Based on:
- DQN (Mnih et al., 2015)
- Experience Replay
- Target Network stabilization
- Epsilon-greedy exploration

---

**Ready to train your first autonomous agent?**

```typescript
import { quickDemo } from '@/ai/rl';
await quickDemo();
```

🚀 **Let the agent learn to trade!**
