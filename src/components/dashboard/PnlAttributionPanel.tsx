import { C, mono } from "../../tokens";
import { Badge, Card, Label } from "../ui";

export function PnlAttributionPanel({ summary }: any) {
  const rows = Array.isArray(summary?.rows) ? summary.rows : [];
  const net = Number((summary?.netPnlKas ?? summary?.estimatedNetPnlKas) || 0);
  const netMode = String(summary?.netPnlMode || "estimated");
  const executed = Number(summary?.executedSignals || 0);
  const quality = Number(summary?.signalQualityScore || 0);
  const timing = Number(summary?.timingAlphaPct || 0);
  const realizedMinConfirmations = Math.max(1, Number(summary?.realizedMinConfirmations || 1));
  const floorMinObserved = Math.max(1, Number(summary?.confirmationFloorObservedMin || realizedMinConfirmations));
  const floorMaxObserved = Math.max(floorMinObserved, Number(summary?.confirmationFloorObservedMax || floorMinObserved));
  const confidenceBrier = Number(summary?.confidenceBrierScore || 0);
  const evCalErrorPct = Number(summary?.evCalibrationErrorPct || 0);
  const realizedVsExpectedEdgeKas = Number(summary?.realizedVsExpectedEdgeKas || 0);
  const regimeHitRatePct = Number(summary?.regimeHitRatePct || 0);
  const regimeHitSamples = Number(summary?.regimeHitSamples || 0);
  const truthDegraded = Boolean(summary?.truthDegraded);
  const truthMismatchRatePct = Number(summary?.truthMismatchRatePct || 0);
  const truthCheckedSignals = Number(summary?.truthCheckedSignals || 0);
  const truthMismatchSignals = Number(summary?.truthMismatchSignals || 0);
  const truthDegradedReason = String(summary?.truthDegradedReason || "");

  const modeLabel = netMode === "realized" ? "Realized" : netMode === "hybrid" ? "Hybrid" : "Estimated";
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, color: C.text, fontWeight: 700, ...mono }}>
            PnL Attribution ({modeLabel})
          </div>
          <Badge text={`REALIZED FLOOR ${realizedMinConfirmations} CONF`} color={realizedMinConfirmations <= 1 ? C.dim : C.warn} />
          <Badge
            text={`FLOOR RANGE ${floorMinObserved}${floorMinObserved !== floorMaxObserved ? `-${floorMaxObserved}` : ""} CONF`}
            color={floorMaxObserved > realizedMinConfirmations ? C.warn : C.dim}
          />
        </div>
        <div style={{ fontSize: 11, color: C.dim }}>
          {netMode === "realized"
            ? `Executed signals are fully receipt-confirmed with chain confirmation timestamps and a ${realizedMinConfirmations}-confirmation realized floor.`
            : netMode === "hybrid"
            ? `Confirmed receipts at or above ${realizedMinConfirmations} confirmation${realizedMinConfirmations === 1 ? "" : "s"} use realized broadcast→confirmation execution drift; remaining execution costs stay estimated.`
            : "Attribution is estimated from quant expected value, queue execution outcomes, fee logs, liquidity buckets, and market snapshots."}
        </div>
        {truthDegraded && (
          <div style={{ fontSize: 11, color: C.danger, marginTop: 8 }}>
            Truth degraded: backend/chain receipt mismatch rate {truthMismatchRatePct.toFixed(1)}% ({truthMismatchSignals}/{truthCheckedSignals} checks).
            Realized mode is downgraded until receipt consistency recovers.
            {truthDegradedReason ? ` (${truthDegradedReason})` : ""}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <Badge
            text={`CHAIN ${Number(summary?.provenanceChainSignals || 0)}/${executed}`}
            color={Number(summary?.provenanceChainSignals || 0) > 0 ? C.ok : C.dim}
          />
          <Badge
            text={`BACKEND ${Number(summary?.provenanceBackendSignals || 0)}/${executed}`}
            color={Number(summary?.provenanceBackendSignals || 0) > 0 ? C.purple : C.dim}
          />
          <Badge
            text={`ESTIMATED ${Number(summary?.provenanceEstimatedSignals || 0)}/${executed}`}
            color={Number(summary?.provenanceEstimatedSignals || 0) > 0 ? C.warn : C.dim}
          />
          {truthDegraded && <Badge text="TRUTH DEGRADED" color={C.danger} />}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginBottom: 12 }}>
        {[
          [netMode === "realized" ? "Net PnL (realized)" : netMode === "hybrid" ? "Net PnL (hybrid)" : "Net PnL (est)", `${net >= 0 ? "+" : ""}${net.toFixed(4)} KAS`, net >= 0 ? C.ok : C.danger],
          ["Fill Rate", `${Number(summary?.fillRatePct || 0).toFixed(1)}%`, Number(summary?.fillRatePct || 0) >= 70 ? C.ok : C.warn],
          ["Confirmed Receipts", `${Number(summary?.confirmedSignals || 0)}`, Number(summary?.confirmedSignals || 0) > 0 ? C.ok : C.dim],
          ["Receipt Coverage", `${Number(summary?.receiptCoveragePct || 0).toFixed(1)}%`, Number(summary?.receiptCoveragePct || 0) >= 50 ? C.ok : C.warn],
          ["Realized Receipt Coverage", `${Number(summary?.realizedReceiptCoveragePct || 0).toFixed(1)}%`, Number(summary?.realizedReceiptCoveragePct || 0) >= 50 ? C.ok : C.warn],
          ["Chain Fee Coverage", `${Number(summary?.chainFeeCoveragePct || 0).toFixed(1)}%`, Number(summary?.chainFeeCoveragePct || 0) >= 50 ? C.ok : C.warn],
          ["Signal Quality", `${quality.toFixed(3)}`, quality >= 0.65 ? C.ok : C.warn],
          ["Conf Brier (↓)", `${confidenceBrier.toFixed(4)}`, confidenceBrier <= 0.20 ? C.ok : C.warn],
          ["EV Cal Error", `${evCalErrorPct.toFixed(3)}%`, evCalErrorPct <= 1.5 ? C.ok : C.warn],
          ["Regime Hit", `${regimeHitRatePct.toFixed(1)}% (${regimeHitSamples})`, regimeHitRatePct >= 55 ? C.ok : C.warn],
          ["Realized vs Exp Edge", `${realizedVsExpectedEdgeKas >= 0 ? "+" : ""}${realizedVsExpectedEdgeKas.toFixed(4)} KAS`, realizedVsExpectedEdgeKas >= 0 ? C.ok : C.warn],
          ["Timing Alpha", `${timing >= 0 ? "+" : ""}${timing.toFixed(3)}%`, timing >= 0 ? C.ok : C.warn],
          ["Avg Confidence", `${Number(summary?.avgSignalConfidence || 0).toFixed(3)}`, C.text],
          ["Avg EV", `${Number(summary?.avgExpectedValuePct || 0).toFixed(3)}%`, C.text],
          ["Missed Fill", `${Number(summary?.missedFillKas || 0).toFixed(4)} KAS`, Number(summary?.missedFillKas || 0) > 0 ? C.warn : C.ok],
          ["Timing Wins", `${Number(summary?.timingWins || 0)}/${Number(summary?.timingSamples || 0)}`, C.dim],
        ].map(([label, value, color]) => (
          <Card key={String(label)} p={12}>
            <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 13, color: color as any, fontWeight: 700, ...mono }}>{value}</div>
          </Card>
        ))}
      </div>

      <Card p={0} style={{ marginBottom: 12 }}>
        <div style={{ padding: "11px 16px", borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 11, color: C.dim, ...mono }}>ATTRIBUTION BREAKDOWN</span>
        </div>
        {rows.length === 0 && <div style={{ padding: 16, fontSize: 12, color: C.dim }}>Run more cycles to build attribution history.</div>}
        {rows.map((row: any) => {
          const value = Number(row?.value || 0);
          const color = value >= 0 ? C.ok : C.danger;
          return (
            <div key={String(row?.label)} style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 4 }}>
                <div style={{ fontSize: 12, color: C.text, ...mono }}>{row?.label}</div>
                <Badge text={`${value >= 0 ? "+" : ""}${value.toFixed(4)}${String(row?.label || "").includes("Alpha") ? "%" : " KAS"}`} color={color} />
              </div>
              {row?.hint && <div style={{ fontSize: 11, color: C.dim }}>{row.hint}</div>}
            </div>
          );
        })}
      </Card>

      <Card p={14}>
        <Label>Execution Funnel</Label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8 }}>
          {[
            ["Actionable Signals", summary?.actionableSignals ?? 0, C.text],
            ["Executed", summary?.executedSignals ?? 0, C.ok],
            ["Pending", summary?.pendingSignals ?? 0, C.warn],
            ["Rejected", summary?.rejectedSignals ?? 0, C.danger],
          ].map(([label, value, color]) => (
            <div key={String(label)} style={{ background: C.s2, borderRadius: 6, padding: "9px 12px" }}>
              <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 3 }}>{label}</div>
              <div style={{ fontSize: 13, color: color as any, fontWeight: 700, ...mono }}>{value}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
