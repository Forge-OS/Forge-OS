# AI Coding Agent Instructions

**For Copilot, Claude Code, and other AI coding assistants working on ForgeOS**

---

## 📖 Required Reading Order

1. **`AGENTS.md`** (root) - Mandatory Kaspa standards + output patterns
2. **`docs/kaspa/links.md`** - Kaspa ecosystem resources
3. **`docs/ai/kaspa-elite-engineer-mode.md`** - Deep Kaspa mastery
4. **`.github/KASPA_ELITE_AGENT.md`** - Comprehensive Kaspa + ForgeOS reference
5. **`.github/KASPA_QUICK_REF.md`** - Quick lookup cheat sheet

---

## 🎯 Quick Navigation

### For Kaspa-Specific Tasks
**Use:** `.github/KASPA_ELITE_AGENT.md`

This file contains:
- Kaspa protocol fundamentals (BlockDAG, GHOSTDAG, UTXO model)
- ForgeOS architecture deep dive
- Wallet provider integration patterns
- Security guardrails (mandatory)
- Quant mathematics reference
- Backend services architecture
- Testing strategies
- Common workflows & troubleshooting

### For Quick Lookups
**Use:** `.github/KASPA_QUICK_REF.md`

Ultra-fast reference for:
- Address formats & units
- Fee calculations
- File locations
- Common commands
- Security checklist
- State machine flows
- Network profiles

### For ForgeOS Architecture
**Use:** Root-level documentation

- `README.md` - Project overview
- `AGENTS.md` - Mandatory coding standards
- `docs/kaspa/links.md` - Ecosystem links
- `docs/ai/kaspa-elite-engineer-mode.md` - Elite engineer training

---

## 🔧 Core Principles

### Kaspa-First Development

This is a **Kaspa-native quant trading control plane**. All code must respect:

1. **UTXO-First** (Not EVM)
   - Transactions built from discrete UTXO inputs
   - Fee estimation via mass calculation
   - DAA score used for confirmation logic
   - Address prefixes: `kaspa:` (mainnet) or `kaspatest:` (testnet)

2. **Non-Custodial Signing**
   - Private keys live in wallet extensions (Kasware/Kaspium) or demo mode only
   - Signing separated from UI/backend logic (`src/wallet/WalletAdapter.ts`)
   - Approvals always explicit; no auto-signing without user confirmation

3. **Quant Core First, AI Second**
   - Deterministic quant engine runs first (`src/quant/quantCore.ts`)
   - AI overlay bounded by quant envelope (never overrides hard risk caps)
   - Fusion logic validates AI output against quant guardrails

4. **Receipt-Aware Execution**
   - Track multi-source truth: estimated → hybrid → realized
   - Receipt lifecycle: submitted → broadcasted → pending_confirm → confirmed/failed/timeout
   - PnL attribution splits `estimated` vs `confirmed` values for transparency

---

## 🚨 Security Rules (Non-Negotiable)

### ❌ NEVER
- Store seeds, private keys, or mnemonics anywhere (including sessionStorage)
- Skip signing confirmation modals for any broadcast transaction
- Mix testnet/mainnet addresses in same session without explicit network switch
- Call wallet methods directly; always use `WalletAdapter` exports
- Assume AI overlay is safe; always validate against quant core first

### ✅ ALWAYS
- Keep signing in `WalletAdapter` layer only
- Validate Kaspa address prefixes before operations
- Use `withTimeout()` on all wallet RPC calls (prevent hangs)
- Hash AI payloads for audit signatures
- Keep network config in env vars + localStorage for testnet override
- Enforce network consistency (no mixing mainnet/testnet)
- Track receipt provenance (chain vs backend vs estimated)

---

## 🧪 Testing Requirements

Before pushing ANY code:

```bash
npm run ci
```

This runs:
1. Domain validation (`npm run verify:domain`)
2. Lint (`npm run lint`)
3. Typecheck (`npm run typecheck`)
4. Unit + perf tests (`npm run test:run`)
5. Build (`npm run build`)
6. Pages fallback sync
7. Smoke tests (`npm run smoke`)

For E2E validation:
```bash
npm run test:e2e
```

For backend load testing:
```bash
npm run load:pipeline
```

---

## 📁 Critical File Locations

### Wallet Integration
```text
src/wallet/WalletAdapter.ts                - Unified wallet interface
src/wallet/providers/*.ts                  - Provider implementations
src/wallet/walletCapabilityRegistry.ts     - Wallet metadata
```

### Quant Engine
```text
src/quant/quantCore.ts                     - Deterministic quant logic
src/quant/runQuantEngine.ts                - AI decision pipeline + fusion
src/quant/runQuantEngineFusion.ts          - Quant ∩ AI guardrail validation
src/quant/runQuantEngineAiTransport.ts     - AI backend call + retry
```

### Execution & Runtime
```text
src/tx/queueTx.ts                          - TX validation + broadcasting
src/runtime/lifecycleMachine.ts            - Agent/TX/Receipt state machines
src/runtime/receiptConsistency.ts          - Backend vs chain verification
src/portfolio/allocator.ts                 - Multi-agent capital allocation
```

### Backend Services
```text
server/ai-proxy/index.mjs                  - AI rate limiting + queueing
server/scheduler/index.mjs                 - Multi-agent cycle dispatch
server/tx-builder/index.mjs                - UTXO packing + fee estimation
server/callback-consumer/index.mjs         - Receipt import + idempotency
server/audit-signer/index.mjs              - Decision audit signing
```

---

## 🎨 Code Style Standards

### Import Pattern
```typescript
// ✓ CORRECT: Use barrel imports
import { connectWallet, signAndBroadcast } from "@/wallet/WalletAdapter"

// ✗ AVOID: Direct provider access
// import kasware from "@/wallet/providers/kasware"
```

### Error Handling
```typescript
// ✓ CORRECT: Explicit timeout + retry
const result = await withTimeout(
  wallet.send(to, amount),
  5000 // 5s timeout
).catch(err => {
  if (isRetryable(err)) {
    return retry(() => wallet.send(to, amount), { attempts: 2 })
  }
  throw err
})

// ✗ AVOID: No timeout, silent failures
const result = await wallet.send(to, amount).catch(() => null)
```

### State Transitions
```typescript
// ✓ CORRECT: Explicit state machine
const newState = transitionQueueTxLifecycle(
  currentState,
  'SIGN_SUCCESS',
  { txid }
)

// ✗ AVOID: Direct mutation
queueItem.status = 'signed'
```

---

## 🔄 Common Workflows

### Adding a New Feature

1. **Read** relevant documentation (KASPA_ELITE_AGENT.md)
2. **Plan** architecture (text diagram + file impact)
3. **Implement** with security guardrails
4. **Test** (unit + integration + e2e)
5. **Validate** (`npm run ci`)
6. **Document** (update relevant .md files)

### Debugging Receipt Issues

1. **Check** receipt lifecycle state
2. **Verify** backend vs chain consistency
3. **Inspect** explorer: `https://explorer.kaspa.org/tx/<txid>`
4. **Review** logs for timeout/retry patterns
5. **Adjust** consistency thresholds if needed

### Optimizing Quant Performance

1. **Profile** hot paths (`npm run test:perf`)
2. **Consider** Web Worker offload (check `useAgentLifecycle.ts`)
3. **Cache** expensive calculations (see `runQuantEngineOverlayCache.ts`)
4. **Validate** math correctness before optimization
5. **Benchmark** before/after improvements

---

## 🌐 Environment Configuration

Key environment variables (see `.env.example`):

### Network & RPC
```bash
VITE_KAS_NETWORK=mainnet
VITE_KAS_API_MAINNET=https://api.kaspa.org
VITE_KAS_API_TESTNET=https://api-tn10.kaspanet.io
```

### Wallet & Execution
```bash
VITE_ACCUMULATION_ADDRESS_MAINNET=kaspa:...
VITE_TREASURY_ADDRESS_MAINNET=kaspa:...
VITE_TREASURY_SPLIT=0.01
VITE_FEE_RATE=1000
```

### AI & Quant
```bash
VITE_AI_API_URL=http://localhost:8788
VITE_AI_OVERLAY_MODE=always
VITE_AI_SOFT_TIMEOUT_MS=9000
VITE_AI_FALLBACK_ENABLED=true
VITE_QUANT_WORKER_ENABLED=true
```

### Backend Services
```bash
VITE_EXECUTION_RECEIPT_API_URL=http://localhost:8796
VITE_DECISION_AUDIT_SIGNER_URL=http://localhost:8791
```

---

## 🚀 Getting Started Checklist

For new AI assistants working on this codebase:

- [ ] Read `AGENTS.md` for mandatory standards
- [ ] Read `.github/KASPA_ELITE_AGENT.md` for Kaspa expertise
- [ ] Review `.github/KASPA_QUICK_REF.md` for quick lookups
- [ ] Run `npm install && npm run ci` to validate setup
- [ ] Explore `src/` to understand module structure
- [ ] Review `tests/` to understand testing patterns
- [ ] Check `server/` for backend service architecture
- [ ] Understand wallet flow: WalletGate → Wizard → Dashboard
- [ ] Understand decision flow: Quant Core → AI Overlay → Fusion → Queue
- [ ] Understand execution flow: Queue → Sign → Broadcast → Receipt → Attribution

---

## 📞 Support & Resources

### Documentation
- Project README: `README.md`
- Developer Guide: `README.dev.md` (if exists)
- TODO files: `TODO*.md`
- Kaspa Links: `docs/kaspa/links.md`

### External Resources
- Kaspa Official: https://kaspa.org/
- Kaspa Docs: https://docs.kas.fyi/
- Kaspa Wiki: https://wiki.kaspa.org/
- Explorer: https://explorer.kaspa.org/
- GHOSTDAG Paper: https://eprint.iacr.org/2018/104.pdf

### Repositories
- Rusty Kaspa: https://github.com/kaspanet/rusty-kaspa
- Kaspa-JS: https://github.com/kaspanet/kaspa-js
- SilverScript: https://github.com/kaspanet/silverscript
- Kaspium Wallet: https://github.com/azbuky/kaspium_wallet
- Kasware Extension: https://github.com/kasware-wallet/extension

---

**Instructions Version**: 1.0.0
**Last Updated**: 2026-02-23
**ForgeOS Version**: 1.0.0
