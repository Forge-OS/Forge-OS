import { useEffect, useRef } from "react";

type Params = {
  status: string;
  runtimeHydrated: boolean;
  loading: boolean;
  liveConnected: boolean;
  kasDataError: string | null;
  nextAutoCycleAt: number;
  cycleIntervalMs: number;
  cycleLockRef: { current: boolean };
  setNextAutoCycleAt: (v: any) => void;
  runCycle: () => Promise<void> | void;
};

export function useAutoCycleLoop(params: Params) {
  const {
    status,
    runtimeHydrated,
    loading,
    liveConnected,
    kasDataError,
    nextAutoCycleAt,
    cycleIntervalMs,
    cycleLockRef,
    setNextAutoCycleAt,
    runCycle,
  } = params;

  const stateRef = useRef({
    loading,
    liveConnected,
    kasDataError,
    nextAutoCycleAt,
    cycleIntervalMs,
    runCycle,
  });

  useEffect(() => {
    stateRef.current = {
      loading,
      liveConnected,
      kasDataError,
      nextAutoCycleAt,
      cycleIntervalMs,
      runCycle,
    };
  }, [loading, liveConnected, kasDataError, nextAutoCycleAt, cycleIntervalMs, runCycle]);

  useEffect(() => {
    if (status !== "RUNNING" || !runtimeHydrated) return;
    const tickId = setInterval(() => {
      const current = stateRef.current;
      if (cycleLockRef.current) return;
      if (current.loading) return;
      if (!current.liveConnected || current.kasDataError) return;
      if (Date.now() < current.nextAutoCycleAt) return;
      setNextAutoCycleAt(Date.now() + current.cycleIntervalMs);
      void current.runCycle();
    }, 1000);
    return () => clearInterval(tickId);
  }, [
    status,
    runtimeHydrated,
    setNextAutoCycleAt,
    cycleLockRef,
  ]);
}
