import { useState } from "react";
import { C, mono } from "../../tokens";
import { shortAddr } from "../../helpers";
import { Badge, Inp, Card } from "../ui";
import { RISK_OPTS, EXEC_OPTS, SIZING_OPTS, PAIR_MODE_OPTS, PNL_TRACKING_OPTS, STRATEGY_TEMPLATES, PROFESSIONAL_PRESETS } from "./constants";

// ── section header ─────────────────────────────────────────────────────────────
const SectionHead = ({ label, sub }: { label: string; sub?: string }) => (
  <div style={{ marginBottom: 8 }}>
    <div style={{ fontSize: 9, color: C.accent, fontWeight: 700, ...mono, letterSpacing: "0.15em" }}>{label}</div>
    {sub && <div style={{ fontSize: 9, color: C.dim, marginTop: 1 }}>{sub}</div>}
  </div>
);

// ── compact option picker ──────────────────────────────────────────────────────
const PickRow = ({ opts, value, onChange, cols = 3 }: { opts: any[]; value: string; onChange: (v: string) => void; cols?: number }) => (
  <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols},1fr)`, gap: 5 }}>
    {opts.map(o => {
      const on = value === o.v;
      return (
        <div key={o.v} onClick={() => onChange(o.v)}
          style={{
            padding: "8px 10px", borderRadius: 6, cursor: "pointer",
            border: `1px solid ${on ? C.accent : "rgba(33,48,67,0.7)"}`,
            background: on ? `linear-gradient(135deg, ${C.accent}18 0%, rgba(8,13,20,0.5) 100%)` : "rgba(16,25,35,0.4)",
            transition: "all 0.15s",
          }}>
          <div style={{ fontSize: 10, color: on ? C.accent : C.text, fontWeight: 700, ...mono, marginBottom: o.desc ? 2 : 0 }}>{o.l}</div>
          {o.desc && <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.3 }}>{o.desc}</div>}
        </div>
      );
    })}
  </div>
);

// ── pair badge ────────────────────────────────────────────────────────────────
const PairBadge = ({ mode }: { mode: string }) => {
  if (mode === "kas-usdc") return <Badge text="KAS/USDC PAIR" color={C.purple} />;
  if (mode === "dual") return <Badge text="DUAL MODE" color={C.warn} />;
  return <Badge text="ACCUMULATION" color={C.accent} />;
};

// ─────────────────────────────────────────────────────────────────────────────

export const WStep1 = ({ d, set, wallet }: any) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const isPairMode = d.pairMode === "kas-usdc" || d.pairMode === "dual";

  const applyPreset = (preset: any) => {
    set("strategyTemplate", preset.id);
    set("strategyLabel", preset.name);
    set("strategyClass", preset.class);
    Object.entries(preset.defaults).forEach(([k, v]) => set(k, v));
    if (preset.id === "custom") setShowAdvanced(true);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 15, color: C.text, fontWeight: 700, ...mono }}>Configure Agent</div>
          <div style={{ fontSize: 10, color: C.dim, marginTop: 1 }}>
            Wallet: <span style={{ color: C.accent, ...mono }}>{shortAddr(wallet?.address)}</span>
          </div>
        </div>
        {d.pairMode && <PairBadge mode={d.pairMode} />}
      </div>

      {/* ── Strategy Templates ── */}
      <div>
        <SectionHead label="STRATEGY PROFILE" sub="Accumulation-first · KAS/USDC pair-ready" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
          {STRATEGY_TEMPLATES.map((tpl) => {
            const on = d.strategyTemplate === tpl.id;
            const isUsdc = tpl.id === "kas_usdc_pair";
            const accent = isUsdc ? C.purple : C.accent;
            return (
              <div key={tpl.id} onClick={() => applyPreset(tpl)}
                style={{
                  padding: "10px 12px", borderRadius: 8, cursor: "pointer",
                  border: `1px solid ${on ? accent : isUsdc ? `${C.purple}30` : "rgba(33,48,67,0.6)"}`,
                  background: on
                    ? `linear-gradient(135deg, ${accent}18 0%, rgba(8,13,20,0.6) 100%)`
                    : isUsdc ? `${C.purple}06` : "rgba(16,25,35,0.4)",
                  boxShadow: on ? `0 2px 10px ${accent}20` : "none",
                  transition: "all 0.18s", position: "relative",
                }}>
                {isUsdc && (
                  <span style={{ position: "absolute", top: 6, right: 6, fontSize: 7, color: C.purple, fontWeight: 700, ...mono, background: `${C.purple}18`, padding: "1px 5px", borderRadius: 3, border: `1px solid ${C.purple}25` }}>
                    PAIR-READY
                  </span>
                )}
                <Badge text={tpl.tag} color={tpl.tagColor || C.ok} />
                <div style={{ fontSize: 11, color: on ? accent : C.text, fontWeight: 700, ...mono, marginTop: 5, marginBottom: 3 }}>{tpl.name}</div>
                <div style={{ fontSize: 9, color: C.dim, lineHeight: 1.35 }}>{tpl.desc}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Professional Presets ── */}
      <div>
        <SectionHead label="PROFESSIONAL PRESETS" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
          {PROFESSIONAL_PRESETS.map((preset) => {
            const on = d.strategyTemplate === preset.id;
            return (
              <div key={preset.id} onClick={() => applyPreset(preset)}
                style={{
                  padding: "9px 11px", borderRadius: 7, cursor: "pointer",
                  border: `1px solid ${on ? C.accent : "rgba(33,48,67,0.6)"}`,
                  background: on ? `linear-gradient(135deg, ${C.accent}12 0%, rgba(8,13,20,0.5) 100%)` : "rgba(16,25,35,0.35)",
                  transition: "all 0.15s",
                }}>
                <Badge text={preset.tag} color={preset.tagColor || C.purple} />
                <div style={{ fontSize: 10, color: on ? C.accent : C.text, fontWeight: 700, ...mono, marginTop: 5, marginBottom: 2 }}>{preset.name}</div>
                {preset.id !== "custom" && (
                  <div style={{ fontSize: 8, color: C.dim, ...mono }}>
                    Risk: {preset.defaults.risk} · {preset.defaults.kpiTarget}% target
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Agent Identity ── */}
      <div>
        <SectionHead label="AGENT IDENTITY" />
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
          <Inp label="Agent Name" value={d.name} onChange={(v: string) => set("name", v)} placeholder="KAS-Alpha-01" />
          <Inp label="ROI Target" value={d.kpiTarget} onChange={(v: string) => set("kpiTarget", v)} type="number" suffix="%" />
          <Inp label="Capital / Cycle" value={d.capitalLimit} onChange={(v: string) => set("capitalLimit", v)} type="number" suffix="KAS" />
        </div>
      </div>

      {/* ── Risk + Pair Mode ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <SectionHead label="RISK TOLERANCE" />
          <PickRow opts={RISK_OPTS} value={d.risk} onChange={(v) => set("risk", v)} cols={3} />
        </div>
        <div>
          <SectionHead label="PAIR MODE" sub="KAS/USDC activates on Kaspa L1" />
          <PickRow opts={PAIR_MODE_OPTS} value={d.pairMode || "accumulation"} onChange={(v) => set("pairMode", v)} cols={3} />
        </div>
      </div>

      {/* KAS/USDC pair params (conditional) */}
      {isPairMode && (
        <div style={{ padding: "10px 14px", background: `${C.purple}08`, border: `1px solid ${C.purple}25`, borderRadius: 8 }}>
          <div style={{ fontSize: 9, color: C.purple, fontWeight: 700, ...mono, marginBottom: 8 }}>KAS / USDC PAIR PARAMS</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <Inp label="Stable Entry Bias" value={d.stableEntryBias || "0.6"} onChange={(v: string) => set("stableEntryBias", v)} type="number" suffix="×" hint="Buy KAS with USDC on dips (0–1)" />
            <Inp label="Stable Exit Bias" value={d.stableExitBias || "0.4"} onChange={(v: string) => set("stableExitBias", v)} type="number" suffix="×" hint="Sell KAS to USDC on strength (0–1)" />
            <Inp label="Slippage Tolerance" value={d.usdcSlippageTolerance || "0.5"} onChange={(v: string) => set("usdcSlippageTolerance", v)} type="number" suffix="%" hint="Max slippage on KAS/USDC trades" />
          </div>
        </div>
      )}

      {/* ── Advanced Config ── */}
      <div style={{ borderTop: `1px solid rgba(33,48,67,0.5)`, paddingTop: 12 }}>
        <div
          onClick={() => setShowAdvanced(s => !s)}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none", marginBottom: showAdvanced ? 12 : 0 }}
        >
          <div>
            <div style={{ fontSize: 10, color: C.accent, fontWeight: 700, ...mono, letterSpacing: "0.1em" }}>
              {showAdvanced ? "▲" : "▼"} ADVANCED STRATEGY CONFIG
            </div>
            <div style={{ fontSize: 8, color: C.dim, marginTop: 1 }}>
              Stop/take-profit · sizing · DAA filters · confidence · limits
            </div>
          </div>
          <Badge text={showAdvanced ? "COLLAPSE" : "EXPAND"} color={C.dim} />
        </div>

        {showAdvanced && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Row 1: Risk params + Position sizing */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <SectionHead label="RISK PARAMS" />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  <Inp label="Stop Loss" value={d.stopLossPct || "4.0"} onChange={(v: string) => set("stopLossPct", v)} type="number" suffix="%" />
                  <Inp label="Take Profit" value={d.takeProfitPct || "10.0"} onChange={(v: string) => set("takeProfitPct", v)} type="number" suffix="%" />
                </div>
              </div>
              <div>
                <SectionHead label="EXECUTION MODE" />
                <PickRow opts={EXEC_OPTS} value={d.execMode} onChange={(v) => set("execMode", v)} cols={3} />
              </div>
            </div>

            {/* Position sizing */}
            <div>
              <SectionHead label="POSITION SIZING" />
              <PickRow opts={SIZING_OPTS} value={d.positionSizing || "kelly"} onChange={(v) => set("positionSizing", v)} cols={3} />
            </div>

            {/* Row 2: Signal filters + Execution limits (all numeric in one grid) */}
            <div>
              <SectionHead label="FILTERS & LIMITS" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
                <Inp label="Min Confidence" value={d.minConfidence || "55"} onChange={(v: string) => set("minConfidence", v)} type="number" suffix="%" hint="Min AI confidence to enter" />
                <Inp label="Min DAA Velocity" value={d.daaVelocityFilter || "0"} onChange={(v: string) => set("daaVelocityFilter", v)} type="number" suffix="blk/s" hint="DAA speed gate (0 = off)" />
                <Inp label="Auto-Approve ≤" value={d.autoApproveThreshold} onChange={(v: string) => set("autoApproveThreshold", v)} type="number" suffix="KAS" hint="Auto-sign below this size" />
                <Inp label="Max Daily Actions" value={d.maxDailyActions || "8"} onChange={(v: string) => set("maxDailyActions", v)} type="number" hint="Hard cap per 24h" />
                <Inp label="Cooldown Cycles" value={d.cooldownCycles || "1"} onChange={(v: string) => set("cooldownCycles", v)} type="number" hint="Idle cycles after execution" />
                <Inp label="Horizon (days)" value={d.horizon} onChange={(v: string) => set("horizon", v)} type="number" hint="KPI evaluation window" />
              </div>
            </div>

            {/* Row 3: P&L tracking + Portfolio allocation */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <SectionHead label="P&L DENOMINATION" />
                <PickRow opts={PNL_TRACKING_OPTS} value={d.pnlTracking || "kas-native"} onChange={(v) => set("pnlTracking", v)} cols={2} />
              </div>
              <div>
                <SectionHead label="PORTFOLIO WEIGHT" />
                <Inp label="Allocation %" value={d.portfolioAllocationPct || "25"} onChange={(v: string) => set("portfolioAllocationPct", v)} type="number" suffix="%" hint="Target % of total portfolio" />
              </div>
            </div>

            {/* Config summary */}
            <Card p={10} style={{ background: `linear-gradient(135deg, ${C.accent}06 0%, rgba(8,13,20,0.5) 100%)`, border: `1px solid ${C.accent}15` }}>
              <div style={{ fontSize: 8, color: C.accent, fontWeight: 700, ...mono, letterSpacing: "0.1em", marginBottom: 8 }}>PARAM SUMMARY</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6 }}>
                {[
                  { k: "Risk", v: String(d.risk || "—").toUpperCase() },
                  { k: "Sizing", v: String(d.positionSizing || "kelly").toUpperCase() },
                  { k: "Pair", v: String(d.pairMode || "accumulation").replace("-", "/").toUpperCase() },
                  { k: "Stop", v: `${d.stopLossPct || "4.0"}%` },
                  { k: "TP", v: `${d.takeProfitPct || "10.0"}%` },
                  { k: "Conf", v: `${d.minConfidence || "55"}%` },
                  { k: "DAA", v: `>${d.daaVelocityFilter || "0"}` },
                  { k: "Daily", v: `${d.maxDailyActions || "8"}` },
                  { k: "P&L", v: String(d.pnlTracking || "kas-native").replace("kas-", "KAS-").replace("usdc-", "USDC-") },
                  { k: "Mode", v: String(d.execMode || "manual").toUpperCase() },
                ].map(item => (
                  <div key={item.k}>
                    <div style={{ fontSize: 7, color: C.dim, ...mono, marginBottom: 1 }}>{item.k}</div>
                    <div style={{ fontSize: 10, color: C.text, fontWeight: 700, ...mono }}>{item.v}</div>
                  </div>
                ))}
              </div>
            </Card>

          </div>
        )}
      </div>

    </div>
  );
};
