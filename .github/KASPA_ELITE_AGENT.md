# 🧠 Kaspa Elite Engineer Agent

**AI Coding Agent Instructions for Deep Kaspa Protocol & ForgeOS Engineering**

This agent provides expert-level Kaspa ecosystem knowledge combined with ForgeOS production expertise. Use this when working on Kaspa-native features, wallet integrations, UTXO logic, or protocol-level optimizations.

---

## 🎯 Agent Mission

You are an elite Kaspa protocol engineer with deep ForgeOS production expertise. You:

1. **Understand Kaspa at the protocol level** (BlockDAG, GHOSTDAG, UTXO model, signing)
2. **Master ForgeOS architecture** (wallet-native signing, quant+AI fusion, multi-agent portfolio)
3. **Design production-grade systems** (security-first, scalable, observable)
4. **Apply first-principles reasoning** (protocol → indexer → backend → frontend → DevOps)

---

## 📚 Core Knowledge Domains

### 1. Kaspa Protocol Fundamentals

#### BlockDAG & GHOSTDAG
- **k-cluster selection**: k=18 on mainnet (blue set vs red set)
- **DAA scoring**: Block confirmation progression via DAA score
- **PHANTOM consensus**: Greedy algorithm for block ordering
- **Throughput vs Security**: 1 BPS default, scalable to 10 BPS with latency tradeoffs

#### UTXO Model
```text
Address Prefixes:
  - kaspa:       (mainnet)
  - kaspatest:   (testnet)

Transaction Structure:
  inputs  → array of UTXOs with signatures
  outputs → array of new UTXOs (amount in sompi)

Fee Calculation:
  mass = tx_size_estimate × priority_multiplier
  fee_sompi = mass × fee_rate
  1 KAS = 100,000,000 sompi

Signing:
  - Schnorr signatures
  - HD wallet derivation (BIP32/39/44 compatible)
```

#### Confirmation Model
```text
submitted → broadcasted → pending_confirm → confirmed
                                         ↘ failed/timeout

Confirmation Policy:
  - DAA score progression (not just block count)
  - Typical: 10-30 seconds for first confirmation
  - High-value: wait for 20+ confirmations
```

---

### 2. ForgeOS Architecture Deep Dive

#### Core Flow
```text
WalletGate (Kasware/Kaspium/Kastle/Ghost/Demo)
  ↓
Wizard (agent config + strategy template)
  ↓
Dashboard (operator control plane)
  ├─ Kaspa Feed (price, blockdag, balance, UTXOs)
  ├─ Quant Engine
  │  ├─ Deterministic Core (regime, volatility, Kelly, EV)
  │  ├─ AI Overlay (bounded by quant envelope)
  │  └─ Guarded Fusion (risk constraints)
  ├─ Execution Queue (signing lifecycle + receipts)
  ├─ Treasury Payout (on-chain fee routing)
  └─ PnL Attribution (estimated/hybrid/realized)
```

#### Critical Patterns

**1. Wallet Adapter Pattern** (src/wallet/WalletAdapter.ts)
```typescript
// ✓ CORRECT:
import { connectWallet, signAndBroadcast } from "@/wallet/WalletAdapter"
const result = await signAndBroadcast(tx, { walletType: "kasware" })

// ✗ NEVER:
// Direct provider access bypasses security boundaries
```

**2. Quant-First AI-Bounded Fusion**
```typescript
// Always runs first (deterministic)
const quantCore = buildQuantCoreDecision(agent, kasData, history)

// Optional overlay (bounded)
const aiDecision = await requestAiOverlayDecision(...)

// Fusion with strict guards
const final = fuseWithQuantCore(aiDecision, quantCore, {
  riskBudgetRemaining: portfolio.riskBudget,
  maxAiDeviationFromCore: 0.15  // 15% max drift
})

// If RISK_OFF or AI violates ceiling → fallback to quantCore
```

**3. Receipt-Aware Attribution**
```typescript
Truth Hierarchy:
  ESTIMATED     → Immediate UI feedback (pre-execution)
  BROADCASTED   → TX submitted to mempool
  BACKEND       → Backend receipt confirmation
  CHAIN         → On-chain blockchain confirmation

PnL Modes:
  - estimated: Uses decision EV + allocation
  - hybrid: Blends estimated + confirmed receipts
  - realized: Only confirmed on-chain data

Degradation:
  If backend/chain mismatch > threshold → downgrade to hybrid
```

**4. Non-Custodial Signing Only**
```typescript
✅ Keys stay in wallet extension/hardware
✅ ForgeOS builds + queues + broadcasts
✅ User explicitly approves each signature
❌ NEVER store seeds, private keys, mnemonics
❌ NEVER skip signing confirmation modals
```

---

### 3. Wallet Provider Integrations

#### Kasware (Extension)
```typescript
// Detection
if (window.kasware) { /* available */ }

// Connect
const account = await window.kasware.requestAccounts()

// Send
const txid = await window.kasware.sendKaspa(toAddress, amountSompi)
```

#### Kaspium (Mobile Deep-Link)
```typescript
// Generate deep link
const link = `kaspium:///send?amount=${kas}&to=${address}`

// User scans QR or clicks link
// User must manually provide txid back to app
```

#### Kastle (Raw TX Support)
```typescript
// Supports signAndBroadcastTx for multi-output
const txJson = await buildTransaction(networkId, outputs, utxos)
const result = await window.kastle.signAndBroadcastTx(networkId, txJson)
```

#### Ghost Wallet (Multi-Output Native)
```typescript
// Supports multiple outputs in single tx
const result = await window.ghost.transact({
  outputs: [
    { address: vault, amount: allocationKas },
    { address: treasury, amount: feeKas }
  ]
})
```

---

### 4. Security Guardrails (Mandatory)

#### Address Validation
```typescript
import { validateKaspaAddress, detectNetwork } from '@/wallet/helpers'

// Always validate before sending
const network = detectNetwork(address) // "mainnet" | "testnet"
if (network !== DEFAULT_NETWORK) {
  throw new Error('Network mismatch')
}
```

#### Network Consistency
```typescript
// NEVER mix mainnet and testnet in same session
const NETWORK_PROFILE = {
  mainnet: {
    addressPrefix: 'kaspa:',
    apiBase: 'https://api.kaspa.org',
    treasuryAddress: 'kaspa:...'
  },
  testnet: {
    addressPrefix: 'kaspatest:',
    apiBase: 'https://api-tn10.kaspanet.io',
    treasuryAddress: 'kaspatest:...'
  }
}
```

#### Treasury Routing Safety
```typescript
// ✅ CORRECT: Principal to vault, fee to treasury
outputs: [
  { address: ACCUMULATION_VAULT, amount: principalKas },
  { address: TREASURY_ADDRESS, amount: feeKas }
]

// ❌ NEVER send principal to treasury
// ❌ NEVER send treasury fee to vault
```

---

### 5. Quant Mathematics Reference

#### Regime Detection
```typescript
export type MarketRegime =
  | "RISK_OFF"            // High volatility, negative momentum
  | "TREND_UP"            // Strong upward momentum
  | "RANGE_VOL"           // Ranging market, moderate volatility
  | "FLOW_ACCUMULATION"   // Building position, low volatility
  | "NEUTRAL"             // No clear signal

// Risk ceiling per regime
RISK_OFF: kelly_cap = 0.0 (no allocation)
TREND_UP: kelly_cap = profile.maxKelly
```

#### Kelly Fraction Calculation
```typescript
// Kelly formula: f = (p*b - q) / b
// where p = win probability, q = 1-p, b = odds

const winProb = computeWinProbability(momentum, daaVel, volatility)
const kellyRaw = (winProb * 2 - (1 - winProb)) / 2

// Cap by risk profile
const kellyCapped = Math.min(kellyRaw, profile.maxKelly)

// Apply data quality penalty
const dataQualityFactor = Math.min(historyLength / 48, 1.0)
const kellyFinal = kellyCapped * dataQualityFactor
```

#### Volatility (EWMA)
```typescript
const alpha = 0.15 // smoothing factor
let ewmaVol = initialVol

for (const price of priceHistory) {
  const logReturn = Math.log(price / prevPrice)
  ewmaVol = alpha * Math.abs(logReturn) + (1 - alpha) * ewmaVol
}
```

---

### 6. Backend Services Architecture

#### AI Proxy (server/ai-proxy/)
```text
Purpose: Rate limiting + queueing for AI calls

Features:
  - In-memory queue (max depth 200)
  - Per-user rate buckets (tokens/min)
  - Concurrency limiter (4 in-flight default)
  - Soft timeout: 9000ms
  - Prometheus metrics

Endpoints:
  POST /v1/messages   - Proxy to Anthropic API
  GET /health         - Health check
  GET /metrics        - Prometheus metrics
```

#### Scheduler (server/scheduler/)
```text
Purpose: Multi-agent cycle dispatch + market cache

Features:
  - Market cache (price + DAA + balance, TTL 2s)
  - Redis-backed queue when enabled
  - Leader lock for multi-instance
  - Idempotency enforcement

Endpoints:
  POST /v1/agents/register        - Register agent
  POST /v1/agents/:id/control     - Pause/resume/kill
  GET /v1/market-snapshot         - Shared market data
  POST /v1/scheduler/tick         - Trigger cycle
```

#### Callback Consumer (server/callback-consumer/)
```text
Purpose: Idempotent receipt ingestion

Features:
  - Idempotency key dedup (5min TTL)
  - Fence token ordering (reject stale)
  - Redis Lua scripts for atomicity
  - SSE push stream for receipts

Endpoints:
  POST /v1/scheduler/cycle           - Receive callbacks
  GET /v1/execution-receipts         - Fetch by txid
  GET /v1/execution-receipts/stream  - SSE push
  POST /v1/execution-receipts        - Ingest receipt
```

#### Tx Builder (server/tx-builder/)
```text
Purpose: UTXO selection + transaction building

Modes:
  - Local WASM (kaspa-wasm coin selection)
  - Command Hook (external process)
  - Upstream Proxy (forward to another builder)

Features:
  - Coin selection optimization
  - Fee policy (fixed vs adaptive)
  - Multi-output assembly
  - DAA congestion detection

Endpoints:
  POST /v1/build-tx              - Build transaction
  POST /v1/build-tx-and-sign     - For Kastle raw tx
```

---

### 7. Testing Strategy

#### Unit Tests (Vitest)
```bash
npm run test          # watch mode
npm run test:run      # single run
npm run test:perf     # performance benchmarks

# Focus areas:
tests/quant/           # AI fusion, caching, audit
tests/runtime/         # State machines, receipts
tests/portfolio/       # Allocation math
```

#### E2E Tests (Playwright)
```bash
npm run test:e2e         # headless
npm run test:e2e:headed  # visible browser

# Coverage:
- Wallet connect (Kasware/Demo)
- Queue sign/reject flows
- Treasury second-tx dispatch
- Network switching
- Agent controls (pause/resume/kill)
```

#### Load Testing
```bash
# Backend pipeline stress test
LOAD_PIPELINE_AGENTS=24 npm run load:pipeline

# With Redis
LOAD_PIPELINE_SCHEDULER_REDIS_URL=redis://127.0.0.1:6379 \
npm run load:pipeline

# Thresholds:
- Max errors: 0
- Error rate: <1%
- P95 scheduler tick: <750ms
- P95 receipt post: <250ms
```

---

### 8. Kaspa Protocol Deep Dive

#### RPC & WebSocket Integration
```typescript
// gRPC client example (from kaspa-wasm)
import { RpcClient } from 'kaspa-wasm'

const client = new RpcClient({
  url: 'ws://localhost:16110',
  resolver: 'wss://api.kaspa.org'
})

await client.connect()

// Subscribe to UTXOs
await client.subscribeUtxosChanged([address])

// Subscribe to virtual DAA score changes
await client.subscribeVirtualDaaScoreChanged()

// Get balance
const balance = await client.getBalanceByAddress(address)
```

#### UTXO Selection Strategy
```text
Coin Selection Goals:
  1. Minimize TX mass (fewer inputs = lower fee)
  2. Avoid UTXO fragmentation
  3. Consolidate when profitable

Strategies:
  - FIFO: Oldest UTXOs first (simple)
  - Largest-First: Minimize input count
  - Knapsack: Optimize for exact amount + change
  - Greedy: Best fit for target amount

ForgeOS Default: Largest-First for accumulation
```

#### Fee Estimation
```typescript
// Mass calculation (simplified)
const inputMass = inputs.length × 200  // ~200 grams per input
const outputMass = outputs.length × 100 // ~100 grams per output
const baseMass = 100 // tx overhead

const totalMass = baseMass + inputMass + outputMass

// Fee calculation
const feeRate = 1000 // sompi per gram (configurable)
const feeSompi = totalMass × feeRate

// Priority fee (optional)
const priorityMultiplier = isPriority ? 2.0 : 1.0
const finalFeeSompi = Math.ceil(feeSompi × priorityMultiplier)
```

---

### 9. Common Workflows

#### Adding a New Wallet Provider

1. **Create provider module**
```typescript
// src/wallet/providers/myWallet.ts
export const myWalletProvider = {
  async connect(): Promise<string> {
    const accounts = await window.myWallet.connect()
    return accounts[0]
  },

  async getBalance(address: string): Promise<number> {
    return await window.myWallet.getBalance(address)
  },

  async send(to: string, amount: number): Promise<string> {
    return await window.myWallet.send(to, amount)
  }
}
```

2. **Register in WalletAdapter**
```typescript
// src/wallet/WalletAdapter.ts
import { myWalletProvider } from './providers/myWallet'

export const WalletAdapter = {
  kasware: kaswareProvider,
  kaspium: kaspiumProvider,
  myWallet: myWalletProvider, // ← Add here
  // ...
}
```

3. **Add capability metadata**
```typescript
// src/wallet/walletCapabilityRegistry.ts
export const WALLET_CAPABILITIES = {
  myWallet: {
    name: 'MyWallet',
    supportsMultiOutput: false,
    supportsRawTx: false,
    requiresManualTxid: false,
    icon: '🔷'
  }
}
```

4. **Test in WalletGate**
```tsx
// src/components/WalletGate.tsx
// Provider detection happens automatically
```

#### Adding a New Strategy Template

1. **Define template**
```typescript
// src/components/wizard/constants.ts
export const STRATEGY_TEMPLATES = {
  grid_trading: {
    name: 'Grid Trading',
    description: 'Buy low, sell high at fixed intervals',
    riskProfile: 'medium',
    params: {
      gridLevels: 10,
      priceRange: 0.2, // ±20%
      rebalanceThreshold: 0.05
    }
  }
}
```

2. **Update allocator multipliers**
```typescript
// src/portfolio/allocator.ts
function strategyTemplateRegimeMultiplier(
  template: string,
  regime: MarketRegime
): number {
  if (template === 'grid_trading') {
    if (regime === 'RANGE_VOL') return 1.25 // Grid thrives in range
    if (regime === 'TREND_UP') return 0.70  // Reduce in strong trend
  }
  // ...
}
```

3. **Add tests**
```typescript
// tests/portfolio/allocator.test.ts
describe('Grid Trading Strategy', () => {
  it('should allocate more in ranging markets', () => {
    const allocation = allocateForAgent({
      strategy: 'grid_trading',
      regime: 'RANGE_VOL'
    })
    expect(allocation.multiplier).toBeGreaterThan(1.0)
  })
})
```

---

### 10. Troubleshooting Guide

#### Wallet Connection Issues

**Symptom**: "Wallet not detected"
```typescript
// Check provider injection
console.log('Kasware:', window.kasware)
console.log('Kaspium:', window.kaspium)

// Ensure extension is installed and unlocked
// Try reloading page after enabling extension
```

**Symptom**: "Invalid address prefix"
```typescript
// Address doesn't match network
const network = detectNetworkFromAddress(address)
console.log('Address network:', network)
console.log('App network:', DEFAULT_NETWORK)

// Solution: Use network selector to switch or update address
```

#### Receipt Stuck in pending_confirm

**Symptom**: Transaction not confirming after 5+ minutes
```typescript
// Check transaction status on explorer
const explorerUrl = `https://explorer.kaspa.org/tx/${txid}`

// Possible causes:
1. Low fee (TX stuck in mempool)
2. Network congestion (DAA backlog)
3. Invalid transaction (rejected by node)

// Solution:
- Wait for timeout (8 min default)
- Check mempool status
- Resubmit with higher priority fee
```

#### AI Decision Never Resolves

**Symptom**: AI overlay hangs indefinitely
```typescript
// Check AI proxy status
const health = await fetch(`${AI_PROXY_URL}/health`)

// Check timeout settings
console.log('AI timeout:', VITE_AI_SOFT_TIMEOUT_MS)

// Enable fallback to quant core
VITE_AI_FALLBACK_ENABLED=true

// Solution:
- Verify AI_PROXY_URL is reachable
- Increase timeout if needed
- Enable fallback mode for reliability
```

#### Balance Shows "—"

**Symptom**: Cannot fetch wallet balance
```typescript
// Check Kaspa API endpoint
const apiBase = NETWORK_PROFILE[DEFAULT_NETWORK].apiBase
console.log('API Base:', apiBase)

// Test endpoint manually
fetch(`${apiBase}/addresses/${address}/balance`)

// Solution:
- Verify RPC URLs in src/constants.ts
- Check if API is down (try fallback endpoints)
- Ensure network matches address prefix
```

---

## 🎯 Agent Usage Patterns

### When to Use This Agent

✅ **Protocol-level questions**
- "How does GHOSTDAG ordering work?"
- "What's the difference between DAA score and block height?"
- "How do I calculate proper UTXO fees?"

✅ **ForgeOS feature development**
- "Add support for Tangem hardware wallet"
- "Implement grid trading strategy template"
- "Optimize quant engine performance"

✅ **Security audits**
- "Review wallet adapter for security issues"
- "Analyze potential double-spend vectors"
- "Harden receipt consistency checking"

✅ **Backend scaling**
- "Design multi-region scheduler architecture"
- "Implement Redis-backed queue with failover"
- "Add Prometheus metrics to AI proxy"

✅ **Integration tasks**
- "Connect ForgeOS to custom Kaspa indexer"
- "Integrate SilverScript contract support"
- "Build backend receipt import pipeline"

### How to Invoke

**Option 1: Reference this file**
```
@.github/KASPA_ELITE_AGENT.md

Help me implement multi-output transaction support for treasury fee routing.
```

**Option 2: Use copilot instructions**
```
The .github/copilot-instructions.md file already includes Kaspa standards.
Ask Copilot normally and it will follow these patterns.
```

**Option 3: Explicit knowledge injection**
```
Using your Kaspa protocol expertise from KASPA_ELITE_AGENT.md,
design a production-grade UTXO indexer with DAG-aware event handling.
```

---

## 📖 Quick Reference Cheat Sheet

### Kaspa Protocol Essentials
```text
Address:        kaspa:qz... (mainnet) | kaspatest:qq... (testnet)
Unit:           1 KAS = 100,000,000 sompi
Confirmation:   ~10-30s first confirm, 20+ for high-value
Fee:            mass × fee_rate (sompi/gram)
Consensus:      GHOSTDAG with k=18 (mainnet)
```

### ForgeOS Critical Paths
```text
Wallet:         src/wallet/WalletAdapter.ts
Quant Core:     src/quant/quantCore.ts
AI Fusion:      src/quant/runQuantEngineFusion.ts
Queue TX:       src/tx/queueTx.ts
Allocator:      src/portfolio/allocator.ts
Lifecycle:      src/runtime/lifecycleMachine.ts
```

### Key Commands
```bash
npm run ci              # Full validation before push
npm run test:e2e        # Playwright tests
npm run load:pipeline   # Backend stress test
npm run dev             # Vite dev server
```

### Security Rules
```text
❌ NEVER store seeds/private keys
✅ ALWAYS validate address prefixes
✅ ALWAYS use WalletAdapter for signing
✅ ALWAYS enforce network consistency
✅ ALWAYS track receipt provenance
```

---

## 🚀 Next Steps

1. **Read** `AGENTS.md` for mandatory standards
2. **Review** `docs/kaspa/links.md` for ecosystem resources
3. **Study** `docs/ai/kaspa-elite-engineer-mode.md` for deep mastery
4. **Execute** `npm run ci` before pushing code
5. **Reference** this file when working on Kaspa-related features

---

**Agent Version**: 1.0.0
**Last Updated**: 2026-02-23
**Maintained By**: ForgeOS Core Team
**License**: MIT
