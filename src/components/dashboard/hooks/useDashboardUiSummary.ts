import { useMemo } from "react";
import { C } from "../../../tokens";

type Params = {
  viewportWidth: number;
  nextAutoCycleAt: number;
  status: string;
  totalFees: number;
  queue: any[];
  decisions: any[];
  liveConnected: boolean;
  kasDataError: string | null;
  wallet: any;
  kasData: any;
  reserveKas: number;
  netFeeKas: number;
  treasuryReserveKas: number;
  wsUrl?: string;
  streamConnected: boolean;
  streamRetryCount: number;
};

export function useDashboardUiSummary(params: Params) {
  const {
    viewportWidth,
    nextAutoCycleAt,
    status,
    totalFees,
    queue,
    decisions,
    liveConnected,
    kasDataError,
    wallet,
    kasData,
    reserveKas,
    netFeeKas,
    treasuryReserveKas,
    wsUrl,
    streamConnected,
    streamRetryCount,
  } = params;

  const isMobile = viewportWidth < 760;
  const isTablet = viewportWidth < 1024;

  const summaryGridCols = useMemo(() => {
    if (isMobile) return "1fr";
    if (isTablet) return "repeat(2,1fr)";
    return "repeat(4,1fr)";
  }, [isMobile, isTablet]);

  const splitGridCols = isTablet ? "1fr" : "2fr 1fr";
  const controlsGridCols = isTablet ? "1fr" : "1fr 1fr";

  const pendingCount = Array.isArray(queue) ? queue.filter((q: any) => q?.status === "pending").length : 0;
  const liveKasNum = Number(kasData?.walletKas || 0);
  const spendableKas = Math.max(0, liveKasNum - reserveKas - netFeeKas - treasuryReserveKas);
  const liveExecutionReady = liveConnected && !kasDataError && wallet?.provider !== "demo";
  const autoCycleCountdown = Math.max(0, Math.ceil((nextAutoCycleAt - Date.now()) / 1000));
  const autoCycleCountdownLabel = `${Math.floor(autoCycleCountdown / 60)
    .toString()
    .padStart(2, "0")}:${(autoCycleCountdown % 60).toString().padStart(2, "0")}`;
  const lastDecision = decisions?.[0]?.dec;
  const lastDecisionSource = String(lastDecision?.decision_source || decisions?.[0]?.source || "ai");
  const streamBadgeText = wsUrl
    ? streamConnected
      ? "STREAM LIVE"
      : streamRetryCount > 0
        ? `STREAM RETRY ${streamRetryCount}`
        : "STREAM DOWN"
    : "STREAM OFF";
  const streamBadgeColor = wsUrl ? (streamConnected ? C.ok : C.warn) : C.dim;

  return {
    isMobile,
    isTablet,
    summaryGridCols,
    splitGridCols,
    controlsGridCols,
    pendingCount,
    liveKasNum,
    spendableKas,
    liveExecutionReady,
    autoCycleCountdownLabel,
    lastDecision,
    lastDecisionSource,
    streamBadgeText,
    streamBadgeColor,
    totalFees,
    status,
  };
}

