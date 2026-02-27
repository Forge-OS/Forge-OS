# Forge-OS 0x Route Integration Spec (Pre-Production)

## Scope
This document defines the `evm_0x` swap route behavior in Forge-OS extension code.

Current status is **fail-closed by default**:
- `VITE_SWAP_ENABLED=false`
- `VITE_SWAP_ROUTE_SOURCE=blocked`
- Execution only activates when explicit env policy is configured.

## 1) Architecture

```text
SwapTab (extension UI)
  -> swap/swap.ts
     -> routeSource.ts (pair-level route policy)
     -> signingDomain.ts (Kaspa signer vs external EVM signer isolation)
     -> 0xAdapter.ts (quote fetch + policy checks)
     -> evmSidecar.ts (MetaMask EIP-1193 sidecar session + send)
     -> settlement.ts + settlementStore.ts (persisted lifecycle/finality)
```

Operational flow:
1. User requests quote.
2. Route source policy selects `evm_0x` only for EVM-token pairs.
3. External signer session is required and chain-allowlisted.
4. 0x quote is fetched and validated before any signature request.
5. User explicitly approves execution.
6. Sidecar signer submits transaction.
7. Settlement lifecycle is persisted and recovered after restart until terminal state.

## 2) Route Source Policy

Policy module: `extension/swap/routeSource.ts`

Rules:
- `blocked`: all swaps denied.
- `kaspa_native`: KAS routes allowed, 0x-token routes denied.
- `evm_0x`: EVM-token routes allowed, native KAS pair routes denied.

Environment controls:
- `VITE_SWAP_ENABLED`
- `VITE_SWAP_ROUTE_SOURCE`
- `VITE_SWAP_EVM_CHAIN_IDS`

## 3) Signing Domain Isolation

Domain module: `extension/swap/signingDomain.ts`

Guarantees:
- `evm_0x` route requires external EVM signer session.
- Managed Kaspa signer remains isolated and is not used for EVM transaction signing.
- Transaction target is validated against expected settler target before execution.

UI consent requirements:
- Explicit consent before sidecar connection.
- Explicit consent before broadcast.

## 4) Quote Source + Pre-Sign Policy

Quote module: `extension/swap/0xAdapter.ts`

Required checks before execution:
- Chain is in allowlist.
- Chain equals active sidecar session chain (`ZEROX_CHAIN_SESSION_MISMATCH` guard).
- Liquidity available.
- Settler target (`transaction.to`) matches configured expected target.
- Allowance spender (if configured) matches expected spender.
- `minBuyAmount` is valid.
- Simulation is complete (`issues.simulationIncomplete` rejects quote).

Execution policy inputs:
- `VITE_SWAP_ZEROX_QUOTE_ENDPOINT`
- `VITE_SWAP_ZEROX_API_KEY` (prefer proxy in production)
- `VITE_SWAP_ZEROX_EXPECTED_SETTLER_TO`
- `VITE_SWAP_ZEROX_EXPECTED_ALLOWANCE_SPENDER`

## 5) Settlement Guarantees

Settlement modules:
- `extension/swap/settlement.ts`
- `extension/swap/settlementStore.ts`
- `extension/swap/swap.ts`

Lifecycle states:
- `REQUESTED -> QUOTED -> SIGNED -> SUBMITTED -> PENDING_CONFIRMATION -> CONFIRMED`
- Terminal failure states:
  - `FAILED_BRIDGE` (signer rejection/send failure)
  - `FAILED_REVERT` (on-chain revert)
  - `FAILED_TIMEOUT` (confirmation timeout)

Guarantees:
- Every execution is persisted to `chrome.storage.local`.
- Pending records are recoverable on extension restart.
- Recovery path enforces timeout as well as confirmation polling.

Operational controls:
- `VITE_SWAP_SETTLEMENT_CONFIRMATIONS`
- `VITE_SWAP_SETTLEMENT_POLL_MS`
- `VITE_SWAP_SETTLEMENT_TIMEOUT_MS`

## 6) Security Model

Fail-closed controls:
- Disabled by default unless env explicitly enables swap route.
- Missing settler/endpoint config disables route.
- Policy mismatch rejects quote before user signing.
- Unexpected transaction target is blocked before broadcast.

Known risk boundaries (current):
- External EVM signer trust model (wallet extension + user confirmation) is out-of-process.
- 0x endpoint/API-key exposure if called directly from client; production should prefer backend proxy.
- Token mapping is intentionally limited to approved EVM addresses.

## 7) Next Production Steps

1. Add WalletConnect sidecar flow (in addition to MetaMask).
2. Add per-origin/per-session swap quotas and signed-intent nonce tracking.
3. Add backend quote proxy with policy attestations and API-key isolation.
4. Expand settlement telemetry (receipt provenance, retries, alert hooks).
