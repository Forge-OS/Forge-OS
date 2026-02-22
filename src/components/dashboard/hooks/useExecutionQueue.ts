import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AGENT_SPLIT,
  FEE_RATE,
  TREASURY_SPLIT,
  RECEIPT_CONSISTENCY_CONFIRM_TS_TOLERANCE_MS,
  RECEIPT_CONSISTENCY_FEE_KAS_TOLERANCE,
  RECEIPT_CONSISTENCY_SLIPPAGE_KAS_TOLERANCE,
  RECEIPT_CONSISTENCY_REPEAT_ALERT_THRESHOLD,
} from "../../../constants";
import { uid } from "../../../helpers";
import { kasPrice, kasTxReceipt } from "../../../api/kaspaApi";
import {
  backendReceiptImportConfigured,
  backendReceiptMetricsConfigured,
  backendReceiptStreamConfigured,
  fetchBackendExecutionReceipt,
  openBackendExecutionReceiptStream,
  postBackendReceiptConsistencyReport,
} from "../../../api/callbackConsumerApi";
import { transitionQueueTxLifecycle, transitionQueueTxReceiptLifecycle } from "../../../runtime/lifecycleMachine";
import { deriveReceiptConsistency } from "../../../runtime/receiptConsistency";
import { broadcastQueueTx, buildQueueTxItem, validateQueueTxItem } from "../../../tx/queueTx";

type UseExecutionQueueParams = {
  wallet: any;
  maxQueueEntries: number;
  addLog: (entry: any) => void;
  kasPriceUsd?: number;
  setTab?: (tab: string) => void;
  onSignedAction?: (signedQueueItem: any) => Promise<void> | void;
  receiptRetryBaseMs?: number;
  receiptRetryMaxMs?: number;
  receiptTimeoutMs?: number;
  receiptMaxAttempts?: number;
  receiptPollIntervalMs?: number;
  receiptPollBatchSize?: number;
  sendAlertEvent?: (evt: any) => Promise<any> | any;
  agentName?: string;
  agentId?: string;
};

export function useExecutionQueue(params: UseExecutionQueueParams) {
  const {
    wallet,
    maxQueueEntries,
    addLog,
    kasPriceUsd = 0,
    setTab,
    onSignedAction,
    receiptRetryBaseMs = 2000,
    receiptRetryMaxMs = 30000,
    receiptTimeoutMs = 8 * 60 * 1000,
    receiptMaxAttempts = 18,
    receiptPollIntervalMs = 1200,
    receiptPollBatchSize = 2,
    sendAlertEvent,
    agentName,
    agentId,
  } = params;

  const [queue, setQueue] = useState([] as any[]);
  const [signingItem, setSigningItem] = useState(null as any);
  const [receiptConsistencyMetricsTick, setReceiptConsistencyMetricsTick] = useState(0);
  const receiptPollInFlightRef = useRef(new Set<string>());
  const queueRef = useRef<any[]>([]);
  const backendReceiptStreamConnectedRef = useRef(false);
  const receiptMismatchCountRef = useRef(new Map<string, number>());
  const receiptMismatchCheckTsRef = useRef(new Map<string, number>());
  const receiptConsistencyReportedCheckTsRef = useRef(new Map<string, number>());
  const backendReceiptImportActive = backendReceiptImportConfigured();
  const backendReceiptStreamActive = backendReceiptStreamConfigured();
  const backendReceiptMetricsActive = backendReceiptMetricsConfigured();
  const BACKEND_RECEIPT_BACKFILL_MAX_ATTEMPTS = 12;
  const receiptConsistencyTolerances = useMemo(
    () => ({
      confirmTsDriftMs: RECEIPT_CONSISTENCY_CONFIRM_TS_TOLERANCE_MS,
      feeKasTolerance: RECEIPT_CONSISTENCY_FEE_KAS_TOLERANCE,
      slippageKasTolerance: RECEIPT_CONSISTENCY_SLIPPAGE_KAS_TOLERANCE,
    }),
    []
  );

  const applyReceiptConsistencyFields = useCallback((item: any) => {
    if (!item || String(item?.status || "") !== "signed") return item;
    const result = deriveReceiptConsistency(item, receiptConsistencyTolerances);
    return {
      ...item,
      receipt_consistency_status: result.status,
      receipt_consistency_mismatches: result.mismatches,
      receipt_consistency_checked_ts: result.checkedTs,
      receipt_consistency_confirm_ts_drift_ms:
        typeof result.confirmTsDriftMs === "number" ? result.confirmTsDriftMs : undefined,
      receipt_consistency_fee_diff_kas:
        typeof result.feeDiffKas === "number" ? result.feeDiffKas : undefined,
      receipt_consistency_slippage_diff_kas:
        typeof result.slippageDiffKas === "number" ? result.slippageDiffKas : undefined,
    };
  }, [receiptConsistencyTolerances]);

  const updateQueueItemLifecycle = useCallback((id: string, event: any, extra: Record<string, any> = {}) => {
    setQueue((prev: any[]) =>
      prev.map((item: any) => {
        if (item?.id !== id) return item;
        const nextStatus = transitionQueueTxLifecycle(String(item?.status || "pending") as any, event);
        return { ...item, status: nextStatus, ...extra };
      })
    );
  }, []);

  const updateQueueItemReceiptLifecycle = useCallback((id: string, event: any, extra: Record<string, any> = {}) => {
    setQueue((prev: any[]) =>
      prev.map((item: any) => {
        if (item?.id !== id) return item;
        const nextReceipt = transitionQueueTxReceiptLifecycle(
          String(item?.receipt_lifecycle || "submitted") as any,
          event
        );
        const merged = { ...item, receipt_lifecycle: nextReceipt, ...extra };
        return applyReceiptConsistencyFields(merged);
      })
    );
  }, [applyReceiptConsistencyFields]);

  const receiptBackoffMs = useCallback((attempts: number) => {
    const step = Math.max(0, Math.min(6, Number(attempts || 0)));
    const jitter = Math.floor(Math.random() * 250);
    return Math.min(receiptRetryMaxMs, receiptRetryBaseMs * (2 ** step) + jitter);
  }, [receiptRetryBaseMs, receiptRetryMaxMs]);

  const decorateBroadcastedSignedItem = useCallback((txItem: any, txid: string, extra: Record<string, any> = {}) => {
    const broadcastTs = Date.now();
    const price = Number(kasPriceUsd || 0);
    return {
      ...txItem,
      status: "signed",
      txid,
      receipt_lifecycle: "broadcasted",
      broadcast_ts: broadcastTs,
      receipt_attempts: 0,
      confirmations: 0,
      receipt_next_check_at: broadcastTs + receiptBackoffMs(0),
      receipt_last_checked_ts: undefined,
      failure_reason: null,
      ...(price > 0 ? { broadcast_price_usd: price } : {}),
      ...extra,
    };
  }, [kasPriceUsd, receiptBackoffMs]);

  const markQueueItemBroadcasted = useCallback((id: string, txid: string, extra: Record<string, any> = {}) => {
    const now = Date.now();
    const price = Number(kasPriceUsd || 0);
    updateQueueItemReceiptLifecycle(id, { type: "BROADCASTED" }, {
      txid,
      broadcast_ts: now,
      receipt_last_checked_ts: undefined,
      receipt_next_check_at: now + receiptBackoffMs(0),
      receipt_attempts: 0,
      confirmations: 0,
      failure_reason: null,
      ...(price > 0 ? { broadcast_price_usd: price } : {}),
      ...extra,
    });
  }, [kasPriceUsd, receiptBackoffMs, updateQueueItemReceiptLifecycle]);

  const applyBackendReceiptToQueueItem = useCallback(async (item: any, backendReceipt: any) => {
    const itemId = String(item?.id || "");
    const txid = String(item?.txid || backendReceipt?.txid || "").trim().toLowerCase();
    if (!itemId || !txid) return false;

    const now = Date.now();
    const status = String(backendReceipt?.status || "confirmed").toLowerCase();
    const confirmTsRaw = Number(backendReceipt?.confirmTs || 0);
    const normalizedConfirmTs =
      confirmTsRaw > 0
        ? (confirmTsRaw < 1_000_000_000_000 ? Math.round(confirmTsRaw * 1000) : Math.round(confirmTsRaw))
        : 0;
    const broadcastTsRaw = Number(backendReceipt?.broadcastTs || 0);
    const normalizedBroadcastTs =
      broadcastTsRaw > 0
        ? (broadcastTsRaw < 1_000_000_000_000 ? Math.round(broadcastTsRaw * 1000) : Math.round(broadcastTsRaw))
        : 0;
    const confirmTsSourceRaw = String(backendReceipt?.confirmTsSource || "").toLowerCase();
    const confirmTsSource =
      confirmTsSourceRaw === "chain" || confirmTsSourceRaw === "poll" ? confirmTsSourceRaw : (normalizedConfirmTs > 0 ? "chain" : undefined);
    const baseExtra = {
      txid,
      receipt_last_checked_ts: now,
      confirmations: Math.max(0, Number(backendReceipt?.confirmations || 0)),
      backend_confirmations: Math.max(0, Number(backendReceipt?.confirmations || 0)),
      failure_reason: null as string | null,
      receipt_source_path: "callback-consumer:/v1/execution-receipts",
      receipt_source: backendReceipt?.source ? String(backendReceipt.source).slice(0, 120) : "callback-consumer",
      receipt_imported_from: "callback_consumer",
      receipt_backend_updated_at:
        Number.isFinite(Number(backendReceipt?.updatedAt)) && Number(backendReceipt.updatedAt) > 0
          ? Math.round(Number(backendReceipt.updatedAt))
          : now,
      receipt_backend_last_checked_ts: now,
      receipt_backend_next_check_at: undefined,
      receipt_backend_attempts: Math.max(0, Number(item?.receipt_backend_attempts || 0)) + 1,
      backend_receipt_slippage_kas:
        Number.isFinite(Number(backendReceipt?.slippageKas)) ? Math.max(0, Number(Number(backendReceipt.slippageKas).toFixed(8))) : undefined,
      receipt_slippage_kas:
        Number.isFinite(Number(backendReceipt?.slippageKas)) ? Math.max(0, Number(Number(backendReceipt.slippageKas).toFixed(8))) : undefined,
      backend_receipt_fee_sompi:
        Number.isFinite(Number(backendReceipt?.feeSompi)) ? Math.max(0, Math.round(Number(backendReceipt.feeSompi))) : undefined,
      receipt_fee_sompi:
        Number.isFinite(Number(backendReceipt?.feeSompi)) ? Math.max(0, Math.round(Number(backendReceipt.feeSompi))) : undefined,
      backend_receipt_fee_kas:
        Number.isFinite(Number(backendReceipt?.feeKas)) ? Math.max(0, Number(Number(backendReceipt.feeKas).toFixed(8))) : undefined,
      receipt_fee_kas:
        Number.isFinite(Number(backendReceipt?.feeKas)) ? Math.max(0, Number(Number(backendReceipt.feeKas).toFixed(8))) : undefined,
      ...(normalizedBroadcastTs > 0 ? { broadcast_ts: normalizedBroadcastTs } : {}),
      ...(normalizedConfirmTs > 0 ? { backend_confirm_ts: normalizedConfirmTs } : {}),
      ...(normalizedConfirmTs > 0 ? { confirm_ts: normalizedConfirmTs } : {}),
      ...(normalizedConfirmTs > 0 ? { confirm_detected_ts: now } : {}),
      ...(confirmTsSource ? { confirm_ts_source: confirmTsSource } : {}),
      ...(normalizedConfirmTs > 0 && confirmTsSource === "chain" ? { receipt_block_time_ms: normalizedConfirmTs } : {}),
      ...(Number.isFinite(Number(backendReceipt?.priceAtBroadcastUsd)) && Number(backendReceipt.priceAtBroadcastUsd) > 0
        ? { broadcast_price_usd: Number(Number(backendReceipt.priceAtBroadcastUsd).toFixed(8)) }
        : {}),
      ...(Number.isFinite(Number(backendReceipt?.priceAtConfirmUsd)) && Number(backendReceipt.priceAtConfirmUsd) > 0
        ? { confirm_price_usd: Number(Number(backendReceipt.priceAtConfirmUsd).toFixed(8)) }
        : {}),
    };

    if (status === "failed" || status === "rejected") {
      updateQueueItemReceiptLifecycle(itemId, { type: "FAILED" }, {
        ...baseExtra,
        receipt_next_check_at: undefined,
        failure_reason: "backend_receipt_failed",
      });
      if (String(item?.receipt_lifecycle || "") !== "failed") {
        addLog({
          type: item?.metaKind === "treasury_fee" ? "TREASURY" : "ERROR",
          msg: `${item?.metaKind === "treasury_fee" ? "Treasury payout" : "Transaction"} failed via backend receipt · txid: ${txid.slice(0, 16)}...`,
          fee: null,
          truthLabel: "ESTIMATED",
          receiptProvenance: "BACKEND",
        });
      }
      return true;
    }

    const isConfirmed = status === "confirmed" || Number(backendReceipt?.confirmations || 0) > 0 || normalizedConfirmTs > 0;
    if (isConfirmed) {
      updateQueueItemReceiptLifecycle(itemId, { type: "CONFIRMED" }, {
        ...baseExtra,
        receipt_next_check_at: undefined,
      });
      if (String(item?.receipt_lifecycle || "") !== "confirmed") {
        addLog({
          type: item?.metaKind === "treasury_fee" ? "TREASURY" : "EXEC",
          msg:
            `${item?.metaKind === "treasury_fee" ? "Treasury payout" : "Transaction"} confirmed via backend receipt` +
            ` · ${Math.max(0, Number(backendReceipt?.confirmations || 0))} conf · txid: ${txid.slice(0, 16)}...`,
          fee: null,
          truthLabel: "BACKEND CONFIRMED",
          receiptProvenance: "BACKEND",
        });
      }
      return true;
    }

    updateQueueItemReceiptLifecycle(itemId, { type: "POLL_PENDING" }, {
      ...baseExtra,
      receipt_attempts: Math.max(0, Number(item?.receipt_attempts || 0)),
      receipt_next_check_at: now + receiptBackoffMs(Math.max(0, Number(item?.receipt_attempts || 0))),
    });
    return true;
  }, [addLog, receiptBackoffMs, updateQueueItemReceiptLifecycle]);

  const pollReceiptForQueueItem = useCallback(async (item: any) => {
    const itemId = String(item?.id || "");
    const txid = String(item?.txid || "");
    if (!itemId || !txid) return;
    const currentReceiptState = String(item?.receipt_lifecycle || "submitted");
    const backendStreamConnected = backendReceiptStreamConnectedRef.current;

    if (backendReceiptImportActive && !backendStreamConnected) {
      try {
        const backendReceipt = await fetchBackendExecutionReceipt(txid);
        if (backendReceipt) {
          await applyBackendReceiptToQueueItem(item, backendReceipt);
          // If backend provided terminal state or imported confirmation telemetry, stop here.
          if (
            String(backendReceipt?.status || "").toLowerCase() === "confirmed" ||
            String(backendReceipt?.status || "").toLowerCase() === "failed" ||
            String(backendReceipt?.status || "").toLowerCase() === "rejected" ||
            Number(backendReceipt?.confirmations || 0) > 0 ||
            Number(backendReceipt?.confirmTs || 0) > 0 ||
            currentReceiptState === "confirmed"
          ) {
            return;
          }
        } else if (currentReceiptState === "confirmed") {
          const backendAttempts = Math.max(0, Number(item?.receipt_backend_attempts || 0)) + 1;
          if (backendAttempts >= BACKEND_RECEIPT_BACKFILL_MAX_ATTEMPTS) {
            updateQueueItemReceiptLifecycle(itemId, { type: "CONFIRMED" }, {
              receipt_backend_last_checked_ts: Date.now(),
              receipt_backend_attempts: backendAttempts,
              receipt_backend_next_check_at: undefined,
              receipt_backend_backfill_exhausted: true,
            });
            return;
          }
          updateQueueItemReceiptLifecycle(itemId, { type: "CONFIRMED" }, {
            receipt_backend_last_checked_ts: Date.now(),
            receipt_backend_attempts: backendAttempts,
            receipt_backend_next_check_at: Date.now() + Math.min(60000, Math.max(5000, receiptRetryBaseMs * (2 ** Math.min(5, backendAttempts)))),
          });
          return;
        }
      } catch {
        if (currentReceiptState === "confirmed") {
          const backendAttempts = Math.max(0, Number(item?.receipt_backend_attempts || 0)) + 1;
          if (backendAttempts >= BACKEND_RECEIPT_BACKFILL_MAX_ATTEMPTS) {
            updateQueueItemReceiptLifecycle(itemId, { type: "CONFIRMED" }, {
              receipt_backend_last_checked_ts: Date.now(),
              receipt_backend_attempts: backendAttempts,
              receipt_backend_next_check_at: undefined,
              receipt_backend_backfill_exhausted: true,
            });
            return;
          }
          updateQueueItemReceiptLifecycle(itemId, { type: "CONFIRMED" }, {
            receipt_backend_last_checked_ts: Date.now(),
            receipt_backend_attempts: backendAttempts,
            receipt_backend_next_check_at: Date.now() + Math.min(60000, Math.max(5000, receiptRetryBaseMs * (2 ** Math.min(5, backendAttempts)))),
          });
          return;
        }
      }
    } else if (currentReceiptState === "confirmed") {
      return;
    }

    const now = Date.now();
    const attempts = Math.max(0, Number(item?.receipt_attempts || 0));
    const firstSeenTs = Math.max(0, Number(item?.broadcast_ts || item?.submitted_ts || item?.ts || now));
    if (currentReceiptState !== "confirmed" && (attempts >= receiptMaxAttempts || (now - firstSeenTs) >= receiptTimeoutMs)) {
      updateQueueItemReceiptLifecycle(itemId, { type: "TIMEOUT" }, {
        receipt_last_checked_ts: now,
        receipt_next_check_at: undefined,
        receipt_attempts: attempts,
        failure_reason: "confirmation_timeout",
      });
      addLog({
        type: item?.metaKind === "treasury_fee" ? "TREASURY" : "EXEC",
        msg: `${item?.metaKind === "treasury_fee" ? "Treasury payout" : "Transaction"} confirmation timeout · txid: ${txid.slice(0, 16)}...`,
        fee: null,
        truthLabel: "ESTIMATED",
        receiptProvenance: "CHAIN",
      });
      return;
    }

    let receipt;
    try {
      receipt = await kasTxReceipt(txid);
    } catch (e: any) {
      const nextAttempts = attempts + 1;
      updateQueueItemReceiptLifecycle(itemId, { type: "POLL_PENDING" }, {
        receipt_last_checked_ts: Date.now(),
        receipt_next_check_at: Date.now() + receiptBackoffMs(nextAttempts),
        receipt_attempts: nextAttempts,
        failure_reason: String(e?.message || "receipt_lookup_failed").slice(0, 240),
      });
      return;
    }

    const checkedTs = Date.now();
    if (!receipt?.found || receipt.status === "pending") {
      const nextAttempts = attempts + 1;
      const timedOut = nextAttempts >= receiptMaxAttempts || (checkedTs - firstSeenTs) >= receiptTimeoutMs;
      if (timedOut) {
        updateQueueItemReceiptLifecycle(itemId, { type: "TIMEOUT" }, {
          receipt_last_checked_ts: checkedTs,
          receipt_next_check_at: undefined,
          receipt_attempts: nextAttempts,
          confirmations: Math.max(0, Number(receipt?.confirmations || 0)),
          failure_reason: "confirmation_timeout",
        });
        addLog({
          type: item?.metaKind === "treasury_fee" ? "TREASURY" : "EXEC",
          msg: `${item?.metaKind === "treasury_fee" ? "Treasury payout" : "Transaction"} confirmation timeout · txid: ${txid.slice(0, 16)}...`,
          fee: null,
          truthLabel: "ESTIMATED",
          receiptProvenance: "CHAIN",
        });
      } else {
        updateQueueItemReceiptLifecycle(itemId, { type: "POLL_PENDING" }, {
          receipt_last_checked_ts: checkedTs,
          receipt_next_check_at: checkedTs + receiptBackoffMs(nextAttempts),
          receipt_attempts: nextAttempts,
          confirmations: Math.max(0, Number(receipt?.confirmations || 0)),
          failure_reason: null,
        });
      }
      return;
    }

    if (receipt.status === "failed") {
      updateQueueItemReceiptLifecycle(itemId, { type: "FAILED" }, {
        receipt_last_checked_ts: checkedTs,
        receipt_next_check_at: undefined,
        receipt_attempts: attempts + 1,
        confirmations: Math.max(0, Number(receipt?.confirmations || 0)),
        failure_reason: "chain_rejected",
      });
      addLog({
        type: item?.metaKind === "treasury_fee" ? "TREASURY" : "ERROR",
        msg: `${item?.metaKind === "treasury_fee" ? "Treasury payout" : "Transaction"} failed on-chain · txid: ${txid.slice(0, 16)}...`,
        fee: null,
        truthLabel: "ESTIMATED",
        receiptProvenance: "CHAIN",
      });
      return;
    }

    const livePrice = Number(kasPriceUsd || 0);
    const confirmPrice = livePrice > 0 ? livePrice : (Number(await kasPrice().catch(() => 0)) || undefined);
    const chainConfirmTs = Number(receipt?.confirmTimeMs || receipt?.blockTime || 0);
    const normalizedConfirmTs =
      chainConfirmTs > 0
        ? (chainConfirmTs < 1_000_000_000_000 ? Math.round(chainConfirmTs * 1000) : Math.round(chainConfirmTs))
        : checkedTs;
    updateQueueItemReceiptLifecycle(itemId, { type: "CONFIRMED" }, {
      receipt_last_checked_ts: checkedTs,
      receipt_next_check_at: undefined,
      receipt_attempts: attempts + 1,
      confirmations: Math.max(0, Number(receipt?.confirmations || 0)),
      chain_confirmations: Math.max(0, Number(receipt?.confirmations || 0)),
      chain_confirm_ts: normalizedConfirmTs,
      confirm_ts: normalizedConfirmTs,
      confirm_detected_ts: checkedTs,
      confirm_ts_source: chainConfirmTs > 0 ? "chain" : "poll",
      receipt_block_time_ms: chainConfirmTs > 0 ? normalizedConfirmTs : undefined,
      chain_receipt_fee_sompi:
        Number.isFinite(Number(receipt?.feeSompi)) ? Math.max(0, Math.round(Number(receipt?.feeSompi))) : undefined,
      receipt_fee_sompi: Number.isFinite(Number(receipt?.feeSompi)) ? Math.max(0, Math.round(Number(receipt?.feeSompi))) : undefined,
      chain_receipt_fee_kas:
        Number.isFinite(Number(receipt?.feeKas)) ? Math.max(0, Number(Number(receipt?.feeKas).toFixed(8))) : undefined,
      receipt_fee_kas: Number.isFinite(Number(receipt?.feeKas)) ? Math.max(0, Number(Number(receipt?.feeKas).toFixed(8))) : undefined,
      receipt_mass: Number.isFinite(Number(receipt?.mass)) ? Math.max(0, Math.round(Number(receipt?.mass))) : undefined,
      receipt_source_path: receipt?.sourcePath ? String(receipt.sourcePath).slice(0, 240) : undefined,
      failure_reason: null,
      ...(confirmPrice ? { confirm_price_usd: confirmPrice } : {}),
      ...(Number.isFinite(Number(item?.amount_kas)) &&
      Number.isFinite(Number(item?.broadcast_price_usd)) &&
      Number.isFinite(Number(confirmPrice)) &&
      Number(item?.amount_kas) > 0 &&
      Number(item?.broadcast_price_usd) > 0 &&
      Number(confirmPrice) > 0
        ? {
            chain_derived_slippage_kas: Number(
              (
                Math.max(0, Number(item?.amount_kas || 0)) *
                Math.abs(
                  (Number(confirmPrice) - Number(item?.broadcast_price_usd || 0)) /
                  Number(item?.broadcast_price_usd || 1)
                )
              ).toFixed(8)
            ),
          }
        : {}),
    });
    addLog({
      type: item?.metaKind === "treasury_fee" ? "TREASURY" : "EXEC",
      msg:
        `${item?.metaKind === "treasury_fee" ? "Treasury payout" : "Transaction"} confirmed` +
        ` · ${Math.max(0, Number(receipt?.confirmations || 0))} conf · txid: ${txid.slice(0, 16)}...`,
      fee: null,
      truthLabel: "CHAIN CONFIRMED",
      receiptProvenance: "CHAIN",
    });
  }, [
    addLog,
    applyBackendReceiptToQueueItem,
    backendReceiptImportActive,
    kasPriceUsd,
    receiptBackoffMs,
    receiptMaxAttempts,
    receiptRetryBaseMs,
    receiptTimeoutMs,
    updateQueueItemReceiptLifecycle,
  ]);

  const sendWalletTransfer = useCallback(async (txItem: any) => {
    return broadcastQueueTx(wallet, validateQueueTxItem(txItem));
  }, [wallet]);

  const prependQueueItem = useCallback((txItem: any) => {
    setQueue((prev: any[]) => [txItem, ...prev].slice(0, maxQueueEntries));
  }, [maxQueueEntries]);

  const prependSignedBroadcastedQueueItem = useCallback((txItem: any, txid: string) => {
    const signedItem = decorateBroadcastedSignedItem(txItem, txid);
    setQueue((prev: any[]) => [signedItem, ...prev].slice(0, maxQueueEntries));
    return signedItem;
  }, [decorateBroadcastedSignedItem, maxQueueEntries]);

  const handleQueueSign = useCallback((item: any) => {
    if (item?.id) updateQueueItemLifecycle(item.id, { type: "BEGIN_SIGN" });
    setSigningItem(item);
  }, [updateQueueItemLifecycle]);

  const handleQueueReject = useCallback((id: string) => {
    const item = queue.find((q: any) => q.id === id);
    updateQueueItemLifecycle(id, { type: "SIGN_REJECT" });
    if (item?.metaKind === "treasury_fee") {
      addLog({ type: "TREASURY", msg: `Treasury fee payout rejected by operator: ${id}`, fee: null });
      return;
    }
    addLog({ type: "SIGN", msg: `Transaction rejected by operator: ${id}`, fee: null });
  }, [addLog, queue, updateQueueItemLifecycle]);

  const handleSigningReject = useCallback(() => {
    if (signingItem?.id) handleQueueReject(signingItem.id);
    setSigningItem(null);
  }, [handleQueueReject, signingItem]);

  const handleSigned = useCallback(async (tx: any) => {
    const signedQueueItem = signingItem ? { ...signingItem, status: "signed", txid: tx.txid } : tx;
    if (signingItem?.id) {
      updateQueueItemLifecycle(signingItem.id, { type: "SIGN_SUCCESS", txid: tx.txid }, { txid: tx.txid });
      markQueueItemBroadcasted(signingItem.id, tx.txid);
    }
    if (signingItem?.metaKind === "treasury_fee") {
      addLog({
        type: "TREASURY",
        msg: `Treasury fee payout signed: ${signingItem?.amount_kas} KAS · txid: ${tx.txid?.slice(0, 16)}...`,
        fee: null,
        truthLabel: "BROADCASTED",
        receiptProvenance: "ESTIMATED",
      });
      setSigningItem(null);
      return;
    }

    addLog({
      type: "EXEC",
      msg: `SIGNED: ${signingItem?.type} · ${signingItem?.amount_kas} KAS · txid: ${tx.txid?.slice(0, 16)}...`,
      fee: 0.08,
      truthLabel: "BROADCASTED",
      receiptProvenance: "ESTIMATED",
    });
    addLog({
      type: "TREASURY",
      msg: `Fee split → Pool: ${(FEE_RATE * AGENT_SPLIT).toFixed(4)} KAS / Treasury: ${(FEE_RATE * TREASURY_SPLIT).toFixed(4)} KAS`,
      fee: FEE_RATE,
    });
    setSigningItem(null);
    if (typeof onSignedAction === "function") {
      await onSignedAction(signedQueueItem);
    }
  }, [addLog, markQueueItemBroadcasted, onSignedAction, signingItem, updateQueueItemLifecycle]);

  const rejectAllPending = useCallback(() => {
    setQueue((prev: any[]) =>
      prev.map((q: any) =>
        q.status === "pending"
          ? { ...q, status: transitionQueueTxLifecycle("pending", { type: "SIGN_REJECT" }) }
          : q
      )
    );
    setSigningItem(null);
  }, []);

  const pollReceiptForQueueItemRef = useRef(pollReceiptForQueueItem);
  const receiptPollParamsRef = useRef({
    backendReceiptImportActive,
    receiptPollBatchSize,
    backendReceiptBackfillMaxAttempts: BACKEND_RECEIPT_BACKFILL_MAX_ATTEMPTS,
  });

  useEffect(() => {
    pollReceiptForQueueItemRef.current = pollReceiptForQueueItem;
  }, [pollReceiptForQueueItem]);

  useEffect(() => {
    receiptPollParamsRef.current = {
      backendReceiptImportActive,
      receiptPollBatchSize,
      backendReceiptBackfillMaxAttempts: BACKEND_RECEIPT_BACKFILL_MAX_ATTEMPTS,
    };
  }, [backendReceiptImportActive, receiptPollBatchSize, BACKEND_RECEIPT_BACKFILL_MAX_ATTEMPTS]);

  useEffect(() => {
    queueRef.current = Array.isArray(queue) ? queue : [];
  }, [queue]);

  useEffect(() => {
    if (!Array.isArray(queue) || queue.length === 0) return;
    const mismatchCounts = receiptMismatchCountRef.current;
    const seenCheckTs = receiptMismatchCheckTsRef.current;
    const reportedCheckTs = receiptConsistencyReportedCheckTsRef.current;

    for (const item of queue) {
      if (!item?.id) continue;
      const itemId = String(item.id);
      const state = String(item?.receipt_consistency_status || "");
      const checkedTs = Math.max(0, Number(item?.receipt_consistency_checked_ts || 0));
      if (backendReceiptMetricsActive && checkedTs > 0) {
        const lastReportedTs = Math.max(0, Number(reportedCheckTs.get(itemId) || 0));
        if (checkedTs !== lastReportedTs && (state === "consistent" || state === "mismatch" || state === "insufficient")) {
          reportedCheckTs.set(itemId, checkedTs);
          void postBackendReceiptConsistencyReport({
            txid: item?.txid,
            queueId: itemId,
            agentId,
            agentName,
            status: state as any,
            mismatches: Array.isArray(item?.receipt_consistency_mismatches) ? item.receipt_consistency_mismatches : [],
            provenance:
              String(item?.receipt_imported_from || "").toLowerCase() === "callback_consumer" ? "BACKEND" : "CHAIN",
            truthLabel:
              String(item?.receipt_imported_from || "").toLowerCase() === "callback_consumer" &&
              String(item?.receipt_lifecycle || "") === "confirmed"
                ? "BACKEND CONFIRMED"
                : String(item?.receipt_lifecycle || "") === "confirmed"
                  ? "CHAIN CONFIRMED"
                  : "ESTIMATED",
            checkedTs,
            confirmTsDriftMs: item?.receipt_consistency_confirm_ts_drift_ms,
            feeDiffKas: item?.receipt_consistency_fee_diff_kas,
            slippageDiffKas: item?.receipt_consistency_slippage_diff_kas,
          }).catch(() => {
            // Metrics reporting is best-effort and must not affect queue lifecycle.
          });
        }
      }
      if (state === "mismatch") {
        const prevCheckTs = Math.max(0, Number(seenCheckTs.get(itemId) || 0));
        if (checkedTs > 0 && checkedTs !== prevCheckTs) {
          seenCheckTs.set(itemId, checkedTs);
          const nextCount = Math.max(0, Number(mismatchCounts.get(itemId) || 0)) + 1;
          mismatchCounts.set(itemId, nextCount);
          setReceiptConsistencyMetricsTick((v) => v + 1);
          addLog({
            type: item?.metaKind === "treasury_fee" ? "TREASURY" : "WARN",
            msg:
              `Receipt consistency mismatch (${(Array.isArray(item?.receipt_consistency_mismatches) ? item.receipt_consistency_mismatches : []).join(",") || "unknown"})` +
              ` · txid: ${String(item?.txid || "").slice(0, 16)}...`,
            fee: null,
            truthLabel:
              String(item?.receipt_imported_from || "").toLowerCase() === "callback_consumer" &&
              String(item?.receipt_lifecycle || "") === "confirmed"
                ? "BACKEND CONFIRMED"
                : String(item?.receipt_lifecycle || "") === "confirmed"
                  ? "CHAIN CONFIRMED"
                  : "ESTIMATED",
            receiptProvenance:
              String(item?.receipt_imported_from || "").toLowerCase() === "callback_consumer" ? "BACKEND" : "CHAIN",
          });
          if (
            typeof sendAlertEvent === "function" &&
            nextCount >= RECEIPT_CONSISTENCY_REPEAT_ALERT_THRESHOLD &&
            nextCount % RECEIPT_CONSISTENCY_REPEAT_ALERT_THRESHOLD === 0
          ) {
            void sendAlertEvent({
              type: "risk_event",
              key: `receipt_consistency:${String(agentId || agentName || "agent")}:${String(item?.txid || itemId)}`,
              title: `${agentName || "Agent"} receipt consistency mismatch`,
              message:
                `Repeated backend/chain receipt mismatch (${nextCount}x) for tx ${String(item?.txid || "").slice(0, 16)}... ` +
                `mismatch=${(Array.isArray(item?.receipt_consistency_mismatches) ? item.receipt_consistency_mismatches : []).join(",") || "unknown"}`,
              severity: "warn",
              meta: {
                agentId,
                agentName,
                txid: item?.txid,
                queueId: itemId,
                mismatches: item?.receipt_consistency_mismatches || [],
                confirmTsDriftMs: item?.receipt_consistency_confirm_ts_drift_ms,
                feeDiffKas: item?.receipt_consistency_fee_diff_kas,
                slippageDiffKas: item?.receipt_consistency_slippage_diff_kas,
              },
            });
          }
        }
      } else if (state === "consistent") {
        seenCheckTs.set(itemId, checkedTs);
      }
    }
  }, [addLog, agentId, agentName, backendReceiptMetricsActive, queue, sendAlertEvent]);

  useEffect(() => {
    backendReceiptStreamConnectedRef.current = false;
    if (!backendReceiptImportActive || !backendReceiptStreamActive) return;

    const stream = openBackendExecutionReceiptStream({
      onStatus: (status) => {
        backendReceiptStreamConnectedRef.current = status === "open";
      },
      onReceipt: (backendReceipt) => {
        const txid = String(backendReceipt?.txid || "").trim().toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(txid)) return;
        const snapshot = queueRef.current;
        if (!Array.isArray(snapshot) || snapshot.length === 0) return;
        const matches = snapshot.filter((item: any) => String(item?.txid || "").trim().toLowerCase() === txid);
        for (const item of matches) {
          void applyBackendReceiptToQueueItem(item, backendReceipt);
        }
      },
    });

    return () => {
      backendReceiptStreamConnectedRef.current = false;
      try { stream?.close?.(); } catch {}
    };
  }, [applyBackendReceiptToQueueItem, backendReceiptImportActive, backendReceiptStreamActive]);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const now = Date.now();
      const inFlight = receiptPollInFlightRef.current;
      const pollParams = receiptPollParamsRef.current;
      const snapshot = queueRef.current;
      const candidates = (Array.isArray(snapshot) ? snapshot : [])
        .filter((item: any) => item?.status === "signed" && /^[a-f0-9]{64}$/i.test(String(item?.txid || "")))
        .filter((item: any) => {
          const state = String(item?.receipt_lifecycle || "submitted");
          if (state === "failed" || state === "timeout") return false;
          if (state === "confirmed") {
            if (!pollParams.backendReceiptImportActive || item?.receipt_backend_updated_at) return false;
            if (backendReceiptStreamConnectedRef.current) return false;
            if (item?.receipt_backend_backfill_exhausted) return false;
            if (Number(item?.receipt_backend_attempts || 0) >= pollParams.backendReceiptBackfillMaxAttempts) return false;
            const nextBackendCheck = Number(item?.receipt_backend_next_check_at || 0);
            return !(nextBackendCheck > 0) || nextBackendCheck <= now;
          }
          return true;
        })
        .filter((item: any) => {
          const state = String(item?.receipt_lifecycle || "submitted");
          const nextCheck = Number(
            state === "confirmed" && pollParams.backendReceiptImportActive && !backendReceiptStreamConnectedRef.current
              ? (item?.receipt_backend_next_check_at || 0)
              : (item?.receipt_next_check_at || 0)
          );
          return !(nextCheck > 0) || nextCheck <= now;
        })
        .filter((item: any) => !inFlight.has(String(item?.id || "")))
        .slice(0, pollParams.receiptPollBatchSize);

      for (const item of candidates) {
        const id = String(item?.id || "");
        if (!id) continue;
        inFlight.add(id);
        void pollReceiptForQueueItemRef.current(item).finally(() => {
          inFlight.delete(id);
        });
      }
    };

    tick();
    const id = setInterval(tick, receiptPollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [
    receiptPollIntervalMs,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (import.meta.env.MODE === "production") return;

    const root = ((window as any).__forgeosTest = (window as any).__forgeosTest || {});
    const dashboardBridge = {
      enqueueQueueTx: (input: any) => {
        const tx = buildQueueTxItem({
          id: uid(),
          from: wallet?.address,
          to: wallet?.address,
          type: "ACCUMULATE",
          amount_kas: 1,
          purpose: "ForgeOS E2E bridge tx",
          metaKind: "action",
          ...input,
        });
        setQueue((prev: any[]) => [tx, ...prev].slice(0, maxQueueEntries));
        return tx.id;
      },
      getQueue: () => queue,
      setTab,
    };

    root.dashboard = dashboardBridge;
    return () => {
      if (root.dashboard === dashboardBridge) delete root.dashboard;
    };
  }, [maxQueueEntries, queue, setTab, wallet?.address]);

  const pendingCount = queue.filter((q: any) => q.status === "pending").length;
  const receiptConsistencyMetrics = useMemo(() => {
    const summary = {
      checked: 0,
      consistent: 0,
      mismatch: 0,
      insufficient: 0,
      repeatedMismatchItems: 0,
      mismatchRatePct: 0,
    };
    for (const item of queue) {
      if (String(item?.status || "") !== "signed") continue;
      const state = String(item?.receipt_consistency_status || "insufficient");
      if (state === "consistent") {
        summary.checked += 1;
        summary.consistent += 1;
      } else if (state === "mismatch") {
        summary.checked += 1;
        summary.mismatch += 1;
      } else {
        summary.insufficient += 1;
      }
      const count = Math.max(0, Number(receiptMismatchCountRef.current.get(String(item?.id || "")) || 0));
      if (count >= RECEIPT_CONSISTENCY_REPEAT_ALERT_THRESHOLD) summary.repeatedMismatchItems += 1;
    }
    summary.mismatchRatePct = summary.checked > 0 ? Number(((summary.mismatch / summary.checked) * 100).toFixed(2)) : 0;
    return summary;
  }, [queue, receiptConsistencyMetricsTick]);

  return {
    queue,
    setQueue,
    signingItem,
    setSigningItem,
    pendingCount,
    sendWalletTransfer,
    updateQueueItemLifecycle,
    updateQueueItemReceiptLifecycle,
    receiptBackoffMs,
    decorateBroadcastedSignedItem,
    markQueueItemBroadcasted,
    prependQueueItem,
    prependSignedBroadcastedQueueItem,
    handleQueueSign,
    handleQueueReject,
    handleSigningReject,
    handleSigned,
    rejectAllPending,
    receiptConsistencyMetrics,
  };
}
