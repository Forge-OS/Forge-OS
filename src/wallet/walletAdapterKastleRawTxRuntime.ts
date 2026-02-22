import { createKastleRawTxRuntime } from "./walletAdapterKastleRawTx";
import {
  ALL_KASPA_ADDRESS_PREFIXES,
  KASTLE_ACCOUNT_CACHE_TTL_MS,
  KASTLE_RAW_TX_MANUAL_JSON_PROMPT_ENABLED,
  KASTLE_TX_BUILDER_STRICT,
  KASTLE_TX_BUILDER_TIMEOUT_MS,
  KASTLE_TX_BUILDER_TOKEN,
  KASTLE_TX_BUILDER_URL,
  WALLET_CALL_TIMEOUT_MS,
  getKastleProvider,
  getKastleRawTxJsonBuilderBridge,
  kastleNetworkIdForCurrentProfile,
  normalizeOutputList,
  withTimeout,
} from "./walletAdapterInternals";
import { normalizeKaspaAddress } from "../helpers";

const kastleRawTxRuntime = createKastleRawTxRuntime({
  allKaspaAddressPrefixes: ALL_KASPA_ADDRESS_PREFIXES,
  walletCallTimeoutMs: WALLET_CALL_TIMEOUT_MS,
  kastleAccountCacheTtlMs: KASTLE_ACCOUNT_CACHE_TTL_MS,
  kastleTxBuilderUrl: KASTLE_TX_BUILDER_URL,
  kastleTxBuilderToken: KASTLE_TX_BUILDER_TOKEN,
  kastleTxBuilderTimeoutMs: KASTLE_TX_BUILDER_TIMEOUT_MS,
  kastleTxBuilderStrict: KASTLE_TX_BUILDER_STRICT,
  kastleRawTxManualJsonPromptEnabled: KASTLE_RAW_TX_MANUAL_JSON_PROMPT_ENABLED,
  getKastleProvider,
  withTimeout,
  normalizeKaspaAddress,
  normalizeOutputList,
  kastleNetworkIdForCurrentProfile,
  getKastleRawTxJsonBuilderBridge,
});

export const getKastleAccountAddress = (...args: Parameters<typeof kastleRawTxRuntime.getKastleAccountAddress>) =>
  kastleRawTxRuntime.getKastleAccountAddress(...args);
export const setKastleAccountCacheAddress = (...args: Parameters<typeof kastleRawTxRuntime.setKastleAccountCacheAddress>) =>
  kastleRawTxRuntime.setKastleAccountCacheAddress(...args);
export const getKastleCachedAccountAddress = (...args: Parameters<typeof kastleRawTxRuntime.getKastleCachedAccountAddress>) =>
  kastleRawTxRuntime.getKastleCachedAccountAddress(...args);
export const buildKastleRawTxJson = (...args: Parameters<typeof kastleRawTxRuntime.buildKastleRawTxJson>) =>
  kastleRawTxRuntime.buildKastleRawTxJson(...args);

