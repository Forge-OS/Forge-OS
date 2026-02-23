# ⚡ Kaspa Quick Reference

**Ultra-fast lookup for Kaspa + ForgeOS development**

---

## 🔧 Kaspa Protocol Basics

### Address Format
```text
Mainnet:  kaspa:qz...
Testnet:  kaspatest:qq...
```

### Units
```text
1 KAS = 100,000,000 sompi
```

### Confirmation Times
```text
First confirm:  ~10-30 seconds
High-value:     20+ confirmations
```

### Fee Calculation
```typescript
mass = (inputs × 200) + (outputs × 100) + 100
fee_sompi = mass × fee_rate
```

### Network Info
```text
Consensus:      GHOSTDAG (k=18)
Block Time:     ~1 second
DAA Score:      Block ordering metric (not height)
```

---

## 🔐 Security Checklist

```text
✅ NEVER store seeds/private keys/mnemonics
✅ ALWAYS validate address prefix matches network
✅ ALWAYS use WalletAdapter (no direct provider access)
✅ ALWAYS enforce network consistency (no mixing mainnet/testnet)
✅ ALWAYS track receipt provenance (chain/backend/estimated)
❌ NEVER skip signing confirmation modals
❌ NEVER send principal to treasury address
❌ NEVER mix network profiles in same session
```

---

## 📁 ForgeOS File Map

### Core Modules
```text
Wallet:         src/wallet/WalletAdapter.ts
Quant Core:     src/quant/quantCore.ts
AI Fusion:      src/quant/runQuantEngineFusion.ts
Queue TX:       src/tx/queueTx.ts
Allocator:      src/portfolio/allocator.ts
Lifecycle:      src/runtime/lifecycleMachine.ts
Receipt:        src/runtime/receiptConsistency.ts
```

### Backend Services
```text
AI Proxy:       server/ai-proxy/index.mjs
Scheduler:      server/scheduler/index.mjs
TX Builder:     server/tx-builder/index.mjs
Callback:       server/callback-consumer/index.mjs
Audit:          server/audit-signer/index.mjs
```

### Configuration
```text
Constants:      src/constants.ts
Network:        src/kaspa/network.ts
Env:            .env (.env.example for template)
```

---

## ⚡ Common Commands

### Development
```bash
npm run dev             # Vite dev server (localhost:5173)
npm run build           # Production build
npm run preview         # Preview production build
```

### Testing
```bash
npm run ci              # Full validation (run before push!)
npm run test            # Vitest watch mode
npm run test:run        # Vitest single run
npm run test:e2e        # Playwright E2E tests
npm run test:perf       # Performance benchmarks
```

### Backend Services
```bash
npm run ai:proxy                    # Start AI proxy
npm run scheduler:start             # Start scheduler
npm run tx-builder:start            # Start tx builder
npm run callback-consumer:start     # Start callback consumer
npm run audit-signer:start          # Start audit signer
```

### Load Testing
```bash
npm run load:pipeline                              # Default load test
LOAD_PIPELINE_AGENTS=24 npm run load:pipeline     # 24 agents
```

---

## 🎨 Wallet Providers

### Kasware (Extension)
```typescript
if (window.kasware) {
  const account = await window.kasware.requestAccounts()
  const txid = await window.kasware.sendKaspa(toAddress, amountSompi)
}
```

### Kaspium (Mobile)
```typescript
const link = `kaspium:///send?amount=${kas}&to=${address}`
// User scans QR, manually provides txid
```

### Kastle (Raw TX)
```typescript
const txJson = await buildTransaction(networkId, outputs, utxos)
const result = await window.kastle.signAndBroadcastTx(networkId, txJson)
```

### Ghost (Multi-Output)
```typescript
const result = await window.ghost.transact({
  outputs: [
    { address: vault, amount: allocation },
    { address: treasury, amount: fee }
  ]
})
```

### Demo Mode
```typescript
// Simulated txids for testing (no real execution)
```

---

## 🧮 Quant Math Quick Formulas

### Kelly Fraction
```typescript
winProb = sigmoid(momentum + daaVel - volPenalty)
kellyRaw = (winProb × 2 - (1 - winProb)) / 2
kellyCapped = min(kellyRaw, profile.maxKelly)
kellyFinal = kellyCapped × dataQualityFactor
```

### Volatility (EWMA)
```typescript
alpha = 0.15
ewmaVol = alpha × abs(logReturn) + (1 - alpha) × ewmaVol_prev
```

### Momentum
```typescript
momentum = (w1 × ret_1pct + w2 × ret_5pct + w3 × ret_20pct) / (w1+w2+w3)
```

### Risk Score
```typescript
riskScore = volatility × exposurePct × (1 - confidence)
```

---

## 📊 State Machines

### Agent Lifecycle
```text
RUNNING ←→ PAUSED
  ↕
SUSPENDED  ERROR
```

### Queue TX Signing
```text
pending → signing → signed
  ↓        ↓
rejected  failed
```

### Queue TX Receipt
```text
submitted → broadcasted → pending_confirm → confirmed
                                         ↘ failed
                                         ↘ timeout
```

---

## 🌐 Network Profiles

### Mainnet
```typescript
{
  addressPrefix: 'kaspa:',
  apiBase: 'https://api.kaspa.org',
  wsUrl: 'wss://api.kaspa.org',
  explorer: 'https://explorer.kaspa.org',
  treasuryAddress: 'kaspa:...',
  accumulationVault: 'kaspa:...'
}
```

### Testnet
```typescript
{
  addressPrefix: 'kaspatest:',
  apiBase: 'https://api-tn10.kaspanet.io',
  wsUrl: 'wss://api-tn10.kaspanet.io',
  explorer: 'https://explorer-tn10.kaspa.org',
  treasuryAddress: 'kaspatest:...',
  accumulationVault: 'kaspatest:...'
}
```

---

## 🔍 Troubleshooting

### Wallet Not Detected
```bash
# Check browser console
console.log(window.kasware, window.kaspium)

# Ensure extension installed & unlocked
# Reload page after enabling extension
```

### Invalid Address Prefix
```typescript
const network = detectNetworkFromAddress(address)
// Ensure network matches DEFAULT_NETWORK
```

### Receipt Stuck
```bash
# Check explorer
https://explorer.kaspa.org/tx/<txid>

# Common causes:
# - Low fee (stuck in mempool)
# - Network congestion
# - Invalid tx (rejected)

# Wait for timeout (8min) or resubmit with higher fee
```

### AI Never Resolves
```bash
# Check AI proxy health
curl ${AI_PROXY_URL}/health

# Enable fallback mode
VITE_AI_FALLBACK_ENABLED=true

# Increase timeout
VITE_AI_SOFT_TIMEOUT_MS=12000
```

### Balance Shows "—"
```bash
# Check API endpoint
echo $VITE_KAS_API_MAINNET

# Test manually
curl https://api.kaspa.org/addresses/<address>/balance

# Try fallback endpoints in src/constants.ts
```

---

## 📚 Key Documentation

### ForgeOS Docs
- `README.md` - Main project overview
- `AGENTS.md` - Mandatory coding standards
- `.github/copilot-instructions.md` - AI agent instructions
- `.github/KASPA_ELITE_AGENT.md` - Deep Kaspa reference
- `docs/kaspa/links.md` - Kaspa ecosystem links

### Kaspa Resources
- Official: https://kaspa.org/
- Docs: https://docs.kas.fyi/
- Wiki: https://wiki.kaspa.org/
- Explorer: https://explorer.kaspa.org/
- GHOSTDAG Paper: https://eprint.iacr.org/2018/104.pdf

### Repositories
- Rusty Kaspa: https://github.com/kaspanet/rusty-kaspa
- Kaspa-JS: https://github.com/kaspanet/kaspa-js
- SilverScript: https://github.com/kaspanet/silverscript
- Kaspium: https://github.com/azbuky/kaspium_wallet
- Kasware: https://github.com/kasware-wallet/extension

---

## 🚀 Adding New Features

### New Wallet Provider
1. Create `src/wallet/providers/myWallet.ts`
2. Register in `src/wallet/WalletAdapter.ts`
3. Add capabilities to `src/wallet/walletCapabilityRegistry.ts`
4. Test in `src/components/WalletGate.tsx`

### New Strategy Template
1. Define in `src/components/wizard/constants.ts`
2. Update multipliers in `src/portfolio/allocator.ts`
3. Add tests in `tests/portfolio/allocator.test.ts`

### New Backend Service
1. Create in `server/<service-name>/index.mjs`
2. Add health check endpoint: `GET /health`
3. Add metrics endpoint: `GET /metrics`
4. Add npm script in `package.json`

---

**Version**: 1.0.0 | **Updated**: 2026-02-23
