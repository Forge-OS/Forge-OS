import { useCallback, useEffect, useRef } from "react";

type Params = {
  /** Latest price from the live feed. Null / 0 = feed not ready. */
  priceUsd: number | null | undefined;
  /** Only trigger while true (e.g. status === "RUNNING" && liveExecutionArmed). */
  enabled: boolean;
  /** % move required to fire an early cycle. Default 1.0. */
  triggerThresholdPct?: number;
  /** Called when threshold is crossed — set nextAutoCycleAt to Date.now()-1 to force immediate tick. */
  onTrigger: (reason: string) => void;
};

/**
 * Watches the live KAS/USD price and fires `onTrigger` whenever price moves
 * more than `triggerThresholdPct` since the last time the threshold was crossed.
 *
 * This makes autonomous agents reactive to market moves instead of always
 * waiting for the blind 30-second heartbeat.
 *
 * Call `resetPriceTrigger()` after a cycle runs so the new price baseline is
 * anchored at the post-cycle price, not the pre-move price.
 */
export function usePriceTrigger({
  priceUsd,
  enabled,
  triggerThresholdPct = 1.0,
  onTrigger,
}: Params) {
  const baselinePriceRef = useRef<number | null>(null);
  const onTriggerRef = useRef(onTrigger);
  const cooldownRef = useRef(false);          // 10 s quiet period after trigger

  useEffect(() => { onTriggerRef.current = onTrigger; }, [onTrigger]);

  useEffect(() => {
    if (!enabled || !priceUsd || priceUsd <= 0) return;

    // Initialise baseline on first live price
    if (baselinePriceRef.current === null) {
      baselinePriceRef.current = priceUsd;
      return;
    }

    if (cooldownRef.current) return;

    const deltaPct =
      (Math.abs(priceUsd - baselinePriceRef.current) / baselinePriceRef.current) * 100;

    if (deltaPct >= triggerThresholdPct) {
      const direction = priceUsd > (baselinePriceRef.current ?? priceUsd) ? "UP" : "DOWN";
      baselinePriceRef.current = priceUsd;    // anchor to new level
      cooldownRef.current = true;
      setTimeout(() => { cooldownRef.current = false; }, 10_000);
      onTriggerRef.current(`price ${direction} ${deltaPct.toFixed(2)}%`);
    }
  }, [priceUsd, enabled, triggerThresholdPct]);

  /** Call after a cycle fires (manual or auto) to re-anchor the baseline. */
  const resetPriceTrigger = useCallback(() => {
    if (priceUsd && priceUsd > 0) {
      baselinePriceRef.current = priceUsd;
    }
    cooldownRef.current = false;
  }, [priceUsd]);

  return { resetPriceTrigger };
}
