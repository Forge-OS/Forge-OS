# Forge.OS - Bug Fix & Feature Implementation Complete

## ✅ Completed Tasks

### 1. Sign & Broadcast Bug Fix (CRITICAL)
- Fixed transaction routing: Principal → agent deposit address (not Treasury)
- Added security validation to prevent principal from going to Treasury
- Transaction outputs now: Principal → agent, Platform fee → Treasury

### 2. Professional Presets Feature (NEW)
- Added Market Maker Pro, Investment Banker, Pro Trader, and Custom presets
- Custom preset with popup configuration modal
- Located at bottom of strategy profiles in the wizard

### 3. Attribution Panel Redesign (NEW)
- Simplified to 4 key metrics: Net PnL, Executed, Quality, Timing
- Clean professional header with gradient cards
- Organized data provenance badges
- Streamlined PnL components table with alternating rows
- Simplified execution funnel with balanced grid

## Problem
When user clicks "Sign & Broadcast" on the Transaction Sign Required page, the app is broadcasting a transaction that sends the user's principal/deposit to the TREASURY address. This is WRONG.

## Required Behavior
- **Deposit (principal)** → Agent deposit address (agent-owned address)
- **Platform fee** → TREASURY address (only the fee portion)
- **Network fee** → handled by wallet

## Implementation Tasks

### 1. Create Agent Deposit Address Management ✅
- [x] Create src/runtime/agentDeposit.ts with functions to derive/manage agent deposit addresses
- [x] Implement deterministic agent address derivation from wallet address
- [x] Add persistence for wallet-address → agent-deposit-address mapping
- [x] Add fetchAgentDepositBalance for balance fetching

### 2. Update Transaction Building (Dashboard.tsx) ✅
- [x] Modify buildQueueTxItem call to use agentDepositAddress instead of ACCUMULATION_VAULT
- [x] Pass agentDepositAddress through to the transaction

### 3. Update Treasury Output Logic (useTreasuryPayout.ts) ✅
- [x] Ensure platform fee goes to TREASURY (already correct)
- [x] Ensure principal output goes to agentDepositAddress

### 4. Update Signing Modal (SigningModal.tsx) ✅
- [x] Show clear breakdown of transaction outputs
- [x] Handle multi-output display properly
- [x] Show: Principal → agentDepositAddress, Platform fee → treasury

### 5. Add Security Validation (queueTx.ts) ✅
- [x] Add validateNoPrincipalToTreasury function
- [x] Integrate validation in validateQueueTxItem
- [x] Ensure no principal goes to treasury

### 6. Balance Display in Header
- [ ] Already showing wallet balance via kasData
- [ ] Add agent balance display (funds at agentDepositAddress) - PARTIAL (API added)

### 7. Testing
- [ ] Manual test: connect wallet, initiate deposit, confirm sign page shows correct outputs
- [ ] Manual test: sign & broadcast, verify on explorer outputs are correct
- [ ] Manual test: header balance updates

---

## Files Changed

1. **src/runtime/agentDeposit.ts** (NEW)
   - Added getAgentDepositAddress() to derive/retrieve agent deposit address
   - Added clearAgentDepositMapping() for session cleanup
   - Added fetchAgentDepositBalance() for balance fetching
   - Added localStorage persistence for wallet → agent mapping

2. **src/components/dashboard/Dashboard.tsx**
   - Added import for getAgentDepositAddress
   - Modified transaction building to use agentDepositAddress instead of ACCUMULATION_VAULT

3. **src/components/dashboard/hooks/useTreasuryPayout.ts**
   - Updated attachCombinedTreasuryOutput to properly structure outputs:
     - Principal → agent deposit address (tag: "primary")
     - Platform fee → TREASURY (tag: "treasury")

4. **src/components/SigningModal.tsx**
   - Added multi-output transaction display
   - Shows Principal → agentDepositAddress breakdown
   - Shows Platform Fee → treasury breakdown
   - Added proper wallet method dispatch for multi-output

5. **src/tx/queueTx.ts**
   - Added validateNoPrincipalToTreasury() security validation
   - Integrated validation in validateQueueTxItem()

## Transaction Output Structure

The fixed transaction now has these outputs:

```
Output #1 (tag: "primary"):
  to: agentDepositAddress
  amount: principalAmount (user's deposit)
  
Output #2 (tag: "treasury"):
  to: TREASURY  
  amount: platformFee (TREASURY_FEE_KAS)
```

Network fee is handled by the wallet automatically.

