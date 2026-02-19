# Forge.OS

ForgeOS is a Kaspa-focused, wallet-native AI trading dashboard prototype.

It provides:
- Wallet-gated access (Kasware, Kaspium, or demo mode)
- Agent setup wizard
- AI decision panel (risk/confidence-based)
- Action queue with signing workflow
- Treasury fee split visibility
- Wallet and UTXO operations panel

## Quick Start

### Prerequisites
- Node.js 18+
- npm 9+
- Optional: Kasware extension
- Optional: Kaspium mobile wallet

### Install
```bash
npm install
```

### Run (Development)
```bash
npm run dev
```

### Strict Validation
```bash
npm run ci
```

### Build (Production)
```bash
npm run build
```

### Preview Build
```bash
npm run preview
```

## Environment
Create a `.env` file from `.env.example` and set values for your target environment.

Core Kaspa settings:
- `VITE_KAS_API`
- `VITE_KAS_EXPLORER`
- `VITE_KAS_NETWORK`
- `VITE_KAS_NETWORK_LABEL`
- `VITE_KAS_WS_URL`
- `VITE_KASPIUM_DEEP_LINK_SCHEME`

AI settings:
- `VITE_AI_API_URL`
- `VITE_AI_MODEL`
- `VITE_ANTHROPIC_API_KEY` (only if calling Anthropic directly from browser)

## Production Readiness Checklist
1. Set repo-level Actions variables for all `VITE_KAS_*` values.
2. Configure `VITE_KAS_WS_URL` for real-time websocket feeds.
3. Use backend proxy for AI (`VITE_AI_API_URL`) to avoid exposing secrets.
4. Run `npm run ci` and ensure all workflows are green.
5. Validate wallet flows:
- Kasware connect/sign/send
- Kaspium deep-link + txid confirmation
6. Confirm GitHub Pages deploy succeeds and loads at:
- `https://gryszzz.github.io/Forge.OS/`

## Core Docs
- Developer architecture: `README.dev.md`
- Kaspa raw links and resources: `docs/kaspa/links.md`
- AI researcher prompts: `docs/ai/kaspa-elite-engineer-mode.md`
- Agent operating rules for this repo: `AGENTS.md`
