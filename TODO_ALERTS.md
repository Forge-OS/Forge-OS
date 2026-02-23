# Alerts System Improvements - TODO

## Phase 1: Fix Critical Alert Logic Issues
- [ ] Fix queue_pending alert - currently fires on every render when pendingCount > 0
- [ ] Add proper state tracking to only alert on state changes
- [ ] Add threshold-based triggering (e.g., alert when pending > 3)

## Phase 2: Enhance Alert Types & Context
- [ ] Add transaction failure alerts (tx_failure type)
- [ ] Add confirmation timeout alerts  
- [ ] Add more metadata to each alert type
- [ ] Add wallet balance context to relevant alerts

## Phase 3: Improve Alert Reliability
- [ ] Add proper deduplication with unique keys per alert instance
- [ ] Add severity escalation for repeated issues
- [ ] Add cooldown logic to prevent alert storms

## Phase 4: UI Improvements
- [ ] Show alert history in AlertsPanel
- [ ] Add last alert timestamp display
- [ ] Add clear test alert functionality

