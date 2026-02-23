# .github/ Directory

**AI Agent Instructions & Workflow Automation for ForgeOS**

---

## 📁 What's In This Directory

### AI Agent Instructions
- **`copilot-instructions.md`** - Main entry point for AI coding assistants (Copilot, Claude Code, etc.)
- **`KASPA_ELITE_AGENT.md`** - Comprehensive Kaspa protocol + ForgeOS engineering reference (18KB)
- **`KASPA_QUICK_REF.md`** - Ultra-fast lookup cheat sheet (7.6KB)

### GitHub Workflows
- **`workflows/`** - GitHub Actions CI/CD pipelines (see `workflows/README.md`)

---

## 🎯 How to Use These Files

### For AI Coding Assistants

When working with ForgeOS, reference these files to get expert-level Kaspa knowledge:

**Option 1: Reference in prompts**
```
@.github/KASPA_ELITE_AGENT.md

Help me implement multi-output transaction support for treasury fee routing.
```

**Option 2: Quick lookup during coding**
```
Check .github/KASPA_QUICK_REF.md for the proper Kaspa address format
```

**Option 3: Use Claude Code naturally**
```
Claude Code reads copilot-instructions.md automatically.
Just ask questions and it will follow Kaspa-first patterns.
```

---

## 📖 File Descriptions

### `copilot-instructions.md`
**Purpose**: Entry point for all AI assistants

**Contains**:
- Reading order for documentation
- Core Kaspa-first principles
- Security rules (mandatory)
- Testing requirements
- Critical file locations
- Code style standards
- Common workflows
- Environment configuration
- Getting started checklist

**When to use**: First file to read when starting work on ForgeOS

---

### `KASPA_ELITE_AGENT.md`
**Purpose**: Deep technical reference for Kaspa + ForgeOS

**Contains**:
- Kaspa Protocol Fundamentals
  - BlockDAG & GHOSTDAG (k-cluster, blue/red sets)
  - UTXO model (address formats, tx structure, signing)
  - Confirmation model (DAA score, timing)
- ForgeOS Architecture
  - Core flow (WalletGate → Wizard → Dashboard)
  - Critical patterns (WalletAdapter, Quant+AI fusion, receipt attribution)
- Wallet Provider Integrations (Kasware, Kaspium, Kastle, Ghost, Demo)
- Security Guardrails (address validation, network consistency, treasury routing)
- Quant Mathematics (Kelly, volatility, momentum, regime detection)
- Backend Services (AI proxy, scheduler, callback consumer, tx-builder, audit signer)
- Testing Strategy (unit, e2e, load testing)
- Protocol Deep Dive (RPC, WebSocket, UTXO selection, fee estimation)
- Common Workflows (adding wallets, strategies, troubleshooting)

**When to use**:
- Implementing new Kaspa-native features
- Security audits
- Backend scaling
- Protocol-level questions
- Integration tasks

**Size**: 18.8 KB (comprehensive reference)

---

### `KASPA_QUICK_REF.md`
**Purpose**: Ultra-fast lookup for day-to-day coding

**Contains**:
- Kaspa protocol basics (address format, units, confirmation times, fees)
- Security checklist (one-line rules)
- ForgeOS file map (quick navigation)
- Common commands (dev, test, build, backend)
- Wallet provider snippets
- Quant math formulas
- State machine flows
- Network profiles (mainnet/testnet)
- Troubleshooting (common issues + fixes)
- Quick feature addition guides

**When to use**:
- Need a quick reminder of address format
- Looking for a specific file location
- Need to run a command
- Quick security checklist review
- Troubleshooting common issues

**Size**: 7.6 KB (optimized for speed)

---

## 🚀 Recommended Usage Patterns

### For New Contributors
```
1. Read: .github/copilot-instructions.md
2. Skim: .github/KASPA_ELITE_AGENT.md (understand structure)
3. Keep open: .github/KASPA_QUICK_REF.md (for lookups)
4. Run: npm run ci (validate setup)
```

### For Feature Development
```
1. Reference: .github/KASPA_ELITE_AGENT.md (relevant section)
2. Lookup: .github/KASPA_QUICK_REF.md (file locations, commands)
3. Implement: Follow security guardrails
4. Test: npm run ci && npm run test:e2e
```

### For Bug Fixes
```
1. Check: .github/KASPA_QUICK_REF.md (troubleshooting section)
2. Deep dive: .github/KASPA_ELITE_AGENT.md (architecture section)
3. Debug: Review critical file locations
4. Validate: npm run test:run (relevant test suite)
```

### For Security Audits
```
1. Review: .github/KASPA_ELITE_AGENT.md (Security Guardrails section)
2. Checklist: .github/KASPA_QUICK_REF.md (Security Checklist)
3. Inspect: Critical paths (WalletAdapter, queueTx, lifecycleMachine)
4. Test: npm run test:e2e (wallet flows)
```

---

## 🔄 Maintenance

### When to Update These Files

**Update `copilot-instructions.md`** when:
- Adding new mandatory standards
- Changing core architectural patterns
- Adding new file structure conventions
- Updating testing requirements

**Update `KASPA_ELITE_AGENT.md`** when:
- Adding new wallet provider integrations
- Implementing new backend services
- Changing quant mathematics formulas
- Updating protocol understanding
- Adding new security patterns

**Update `KASPA_QUICK_REF.md`** when:
- Adding new npm scripts
- Changing file locations
- Adding new environment variables
- Updating common workflows
- Adding new troubleshooting entries

---

## 📊 File Size Comparison

| File | Size | Purpose | Read Time |
|------|------|---------|-----------|
| `copilot-instructions.md` | 9.2 KB | Entry point | 5 min |
| `KASPA_ELITE_AGENT.md` | 18.8 KB | Deep reference | 15-20 min |
| `KASPA_QUICK_REF.md` | 7.6 KB | Quick lookup | 2-3 min |

**Total knowledge base**: ~35.6 KB of Kaspa + ForgeOS expertise

---

## 🎓 Learning Path

### Beginner (New to Kaspa)
```
Day 1: copilot-instructions.md (core principles)
Day 2: KASPA_QUICK_REF.md (basics + file map)
Day 3: KASPA_ELITE_AGENT.md (Kaspa Protocol section)
Week 1: Build first feature with guidance
```

### Intermediate (Familiar with Kaspa)
```
- Read KASPA_ELITE_AGENT.md (ForgeOS Architecture)
- Review security guardrails
- Study wallet integration patterns
- Implement wallet provider or strategy template
```

### Advanced (Contributing Core Features)
```
- Master KASPA_ELITE_AGENT.md (all sections)
- Deep dive into backend services architecture
- Study quant mathematics and fusion logic
- Implement backend scaling or protocol optimizations
```

---

## 🔗 Integration with Root Documentation

This `.github/` directory complements root-level docs:

```text
Root Level:
  AGENTS.md                    → Mandatory standards
  README.md                    → Project overview
  docs/kaspa/links.md          → Ecosystem resources
  docs/ai/kaspa-elite-engineer-mode.md → Deep mastery training

.github/ Level:
  copilot-instructions.md      → AI assistant entry point
  KASPA_ELITE_AGENT.md         → Technical reference
  KASPA_QUICK_REF.md           → Quick lookup
```

**Reading Order**:
1. Root `AGENTS.md` (standards)
2. Root `docs/kaspa/links.md` (ecosystem)
3. Root `docs/ai/kaspa-elite-engineer-mode.md` (mastery)
4. `.github/copilot-instructions.md` (AI setup)
5. `.github/KASPA_ELITE_AGENT.md` (deep reference)
6. `.github/KASPA_QUICK_REF.md` (daily use)

---

## 🤖 AI Agent Compatibility

These instructions work with:
- ✅ **GitHub Copilot** (reads `copilot-instructions.md` automatically)
- ✅ **Claude Code** (reference via `@` mention)
- ✅ **Cursor** (add to `.cursorrules`)
- ✅ **ChatGPT** (paste relevant sections in system prompt)
- ✅ **Any AI assistant** (copy/paste or reference)

---

## 📝 Version History

**v1.0.0** (2026-02-23)
- Initial release
- Created copilot-instructions.md
- Created KASPA_ELITE_AGENT.md (18.8 KB comprehensive reference)
- Created KASPA_QUICK_REF.md (7.6 KB quick lookup)
- Integrated Kaspa Sovereign Architect Engine methodology
- Combined ForgeOS production expertise with protocol-level knowledge

---

## 🙏 Credits

**Knowledge Sources**:
- Kaspa Official Documentation
- GHOSTDAG/PHANTOM Research Papers
- Rusty Kaspa Implementation
- ForgeOS Production Codebase
- Kaspa Sovereign Architect Engine Methodology

**Maintained By**: ForgeOS Core Team

---

**Directory Version**: 1.0.0
**Last Updated**: 2026-02-23
**License**: MIT
