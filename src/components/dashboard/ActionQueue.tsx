import { AGENT_SPLIT, EXPLORER, FEE_RATE, TREASURY_SPLIT } from "../../constants";
import { fmtT, shortAddr } from "../../helpers";
import { C, mono } from "../../tokens";
import { Badge, Btn, Card, ExtLink } from "../ui";

export function ActionQueue({queue, wallet, onSign, onReject, receiptConsistencyMetrics}: any) {
  const receiptColor = (state: string) => {
    if (state === "confirmed") return C.ok;
    if (state === "failed" || state === "timeout") return C.danger;
    if (state === "pending_confirm" || state === "broadcasted") return C.warn;
    return C.dim;
  };
  const receiptProvenance = (item: any) => {
    if (String(item?.status || "") !== "signed") return null;
    const imported = String(item?.receipt_imported_from || "").toLowerCase();
    const sourcePath = String(item?.receipt_source_path || "").toLowerCase();
    const confirmSource = String(item?.confirm_ts_source || "").toLowerCase();
    if (imported === "callback_consumer" || sourcePath.includes("callback-consumer")) {
      return { text: "BACKEND", color: C.purple };
    }
    if (imported === "kaspa_api" || confirmSource === "chain") {
      return { text: "CHAIN", color: C.ok };
    }
    return { text: "ESTIMATED", color: C.warn };
  };
  const truthLabel = (item: any) => {
    if (String(item?.status || "") !== "signed") return { text: "ESTIMATED", color: C.warn };
    const prov = receiptProvenance(item);
    const receiptState = String(item?.receipt_lifecycle || "submitted");
    if (receiptState === "confirmed") {
      if (prov.text === "BACKEND") return { text: "BACKEND CONFIRMED", color: C.purple };
      if (prov.text === "CHAIN") return { text: "CHAIN CONFIRMED", color: C.ok };
      return { text: "ESTIMATED", color: C.warn };
    }
    if (receiptState === "broadcasted" || receiptState === "pending_confirm" || receiptState === "submitted") {
      return { text: "BROADCASTED", color: C.warn };
    }
    return { text: "ESTIMATED", color: C.warn };
  };
  const consistencyBadge = (item: any) => {
    if (String(item?.status || "") !== "signed") return null;
    const state = String(item?.receipt_consistency_status || "insufficient");
    if (state === "consistent") return { text: "CONSISTENT", color: C.ok };
    if (state === "mismatch") return { text: "MISMATCH", color: C.danger };
    return { text: "CHECKING", color: C.dim };
  };
  return(
    <div>
      <div style={{fontSize:13, color:C.text, fontWeight:700, ...mono, marginBottom:4}}>Action Queue</div>
      <div style={{display:"flex", flexWrap:"wrap", gap:8, alignItems:"center", marginBottom:16}}>
        <div style={{fontSize:12, color:C.dim}}>Transactions pending wallet signature. Auto-approved items processed immediately.</div>
        {receiptConsistencyMetrics && (
          <div style={{display:"flex", gap:6, flexWrap:"wrap"}}>
            <Badge text={`RC ${Number(receiptConsistencyMetrics.checked || 0)} checked`} color={C.dim} />
            <Badge text={`OK ${Number(receiptConsistencyMetrics.consistent || 0)}`} color={C.ok} />
            <Badge text={`MM ${Number(receiptConsistencyMetrics.mismatch || 0)}`} color={C.danger} />
            {Number(receiptConsistencyMetrics.repeatedMismatchItems || 0) > 0 && (
              <Badge text={`REPEAT ${Number(receiptConsistencyMetrics.repeatedMismatchItems || 0)}`} color={C.warn} />
            )}
          </div>
        )}
      </div>
      {queue.length===0 && (
        <Card p={32} style={{textAlign:"center"}}>
          <div style={{fontSize:13, color:C.dim, ...mono, marginBottom:4}}>Queue empty</div>
          <div style={{fontSize:12, color:C.dim}}>Pending transactions will appear here awaiting your wallet signature.</div>
        </Card>
      )}
      {queue.map((item: any)=> (
        <Card
          key={item.id}
          p={18}
          data-testid={`queue-item-${String(item.id)}`}
          style={{marginBottom:10, border:`1px solid ${item.status==="pending"?C.warn:item.status==="signed"?C.ok:C.border}25`}}
        >
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12}}>
            <div>
              <div style={{display:"flex", gap:8, alignItems:"center", marginBottom:4}}>
                <Badge data-testid={`queue-item-type-${String(item.id)}`} text={item.type} color={C.purple}/>
                <Badge
                  data-testid={`queue-item-status-${String(item.id)}`}
                  text={item.status.toUpperCase()}
                  color={item.status==="pending"?C.warn:item.status==="signed"?C.ok:C.dim}
                  dot
                />
                {item.status==="signed" && (
                  <Badge
                    data-testid={`queue-item-receipt-${String(item.id)}`}
                    text={String(item.receipt_lifecycle || "submitted").toUpperCase().replace(/_/g, " ")}
                    color={receiptColor(String(item.receipt_lifecycle || "submitted"))}
                    dot
                  />
                )}
                {item.status==="signed" && (
                  <Badge
                    data-testid={`queue-item-truth-${String(item.id)}`}
                    text={truthLabel(item).text}
                    color={truthLabel(item).color}
                  />
                )}
                {item.status==="signed" && (() => {
                  const prov = receiptProvenance(item);
                  return prov ? (
                    <Badge
                      data-testid={`queue-item-provenance-${String(item.id)}`}
                      text={prov.text}
                      color={prov.color}
                    />
                  ) : null;
                })()}
                {item.status==="signed" && (() => {
                  const c = consistencyBadge(item);
                  return c ? (
                    <Badge
                      data-testid={`queue-item-consistency-${String(item.id)}`}
                      text={c.text}
                      color={c.color}
                    />
                  ) : null;
                })()}
              </div>
              <div style={{fontSize:11, color:C.dim, ...mono}}>{fmtT(item.ts)}</div>
            </div>
            <div style={{fontSize:18, color:item.amount_kas>0?C.accent:C.danger, fontWeight:700, ...mono}}>{item.amount_kas} KAS</div>
          </div>
          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:item.status==="pending"?12:0, fontSize:12, color:C.dim, ...mono}}>
            <div>To: <span style={{color:C.text}}>{shortAddr(item.to)}</span></div>
            <div>
              {item.metaKind === "treasury_fee"
                ? <>Routing: <span style={{color:C.warn}}>Treasury payout transfer</span></>
                : item?.treasuryCombined
                  ? <>Routing: <span style={{color:C.ok}}>Combined treasury output ({Array.isArray(item?.outputs) ? item.outputs.length : 2} outputs)</span></>
                  : <>Fee split: <span style={{color:C.text}}>Pool {(FEE_RATE*AGENT_SPLIT).toFixed(4)} / Treasury {(FEE_RATE*TREASURY_SPLIT).toFixed(4)}</span></>}
            </div>
          </div>
          {item.status==="pending" && (
            <div style={{display:"flex", gap:8}}>
              <Btn onClick={()=>onReject(item.id)} variant="danger" size="sm">REJECT</Btn>
              <Btn data-testid={`queue-item-sign-${String(item.id)}`} onClick={()=>onSign(item)} size="sm">SIGN & BROADCAST</Btn>
            </div>
          )}
          {item.status==="signed" && item.txid && (
            <div>
              <div style={{display:"flex", alignItems:"center", gap:10, flexWrap:"wrap"}}>
                <span style={{fontSize:11, color:C.ok, ...mono}}>✓ {item.txid.slice(0,32)}...</span>
                {typeof item.confirmations === "number" && (
                  <span style={{fontSize:11, color:C.dim, ...mono}}>
                    conf: {Math.max(0, Number(item.confirmations || 0))}
                  </span>
                )}
                <ExtLink href={`${EXPLORER}/txs/${item.txid}`} label="EXPLORER ↗"/>
              </div>
              {(item.receipt_lifecycle === "failed" || item.receipt_lifecycle === "timeout") && item.failure_reason && (
                <div style={{fontSize:11, color:C.danger, ...mono, marginTop:6}}>
                  receipt: {String(item.failure_reason)}
                </div>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
