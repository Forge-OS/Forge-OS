import { useState } from "react";
import { NET_FEE, TREASURY } from "../constants";
import { shortAddr } from "../helpers";
import { C, mono } from "../tokens";
import { WalletAdapter } from "../wallet/WalletAdapter";
import { formatForgeError } from "../runtime/errorTaxonomy";
import { Btn, Card } from "./ui";

export function SigningModal({tx, wallet, onSign, onReject}: any) {
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null as any);

  // Extract outputs for multi-output transactions
  const outputs = Array.isArray(tx?.outputs) ? tx.outputs : null;
  const hasMultiOutputs = outputs && outputs.length > 1;
  
  // Determine the principal (primary) and fee outputs
  const principalOutput = outputs?.find((o: any) => (o.tag || "").toLowerCase() === "primary") 
    || { to: tx.to, amount_kas: tx.amount_kas };
  const treasuryOutput = outputs?.find((o: any) => (o.tag || "").toLowerCase() === "treasury");

  const sign = async () => {
    setBusy(true); setErr(null);
    try {
      let txid;
      if(wallet?.provider === "kasware") {
        txid = await WalletAdapter.sendKasware(tx.to, tx.amount_kas);
      } else if(wallet?.provider === "kastle") {
        // Handle multi-output for kastle
        if (hasMultiOutputs && outputs) {
          txid = await WalletAdapter.sendKastleRawTx(outputs, tx.purpose);
        } else {
          txid = await WalletAdapter.sendKastle(tx.to, tx.amount_kas);
        }
      } else if(wallet?.provider === "ghost") {
        if (outputs && outputs.length > 0) {
          txid = await WalletAdapter.sendGhostOutputs(outputs, tx.purpose);
        } else {
          txid = await WalletAdapter.sendGhost(tx.to, tx.amount_kas);
        }
      } else if(wallet?.provider === "tangem" || wallet?.provider === "onekey") {
        txid = await WalletAdapter.sendHardwareBridge(wallet.provider, tx.to, tx.amount_kas, tx.purpose, tx.outputs);
      } else if(wallet?.provider === "kaspium") {
        txid = await WalletAdapter.sendKaspium(tx.to, tx.amount_kas, tx.purpose);
      } else {
        // Simulate for demo/non-extension environments
        await new Promise(r=>setTimeout(r,1200));
        txid = Array.from({length:64},()=>"0123456789abcdef"[Math.floor(Math.random()*16)]).join("");
      }
      onSign({ ...tx, txid, signed_at: Date.now() });
    } catch(e: any) { setErr(formatForgeError(e)); }
    setBusy(false);
  };

  // Build the transaction breakdown rows
  const breakdownRows: Array<[string, string, string?]> = [
    ["Type", tx.type],
    ["From", shortAddr(tx.from)],
  ];
  
  if (hasMultiOutputs && outputs) {
    // Multi-output transaction breakdown
    breakdownRows.push(["Principal", `${principalOutput.amount_kas} KAS`, shortAddr(principalOutput.to)]);
    if (treasuryOutput) {
      breakdownRows.push(["Platform Fee", `${treasuryOutput.amount_kas} KAS`, shortAddr(treasuryOutput.to)]);
    }
    breakdownRows.push(["Network Fee", `${NET_FEE} KAS`]);
    breakdownRows.push(["Total", `${Number(tx.amount_kas) + Number(treasuryOutput?.amount_kas || 0) + NET_FEE} KAS`]);
  } else {
    // Single output (original format)
    breakdownRows.push(["To", shortAddr(tx.to)]);
    breakdownRows.push(["Amount", `${tx.amount_kas} KAS`]);
    breakdownRows.push(["Fee", `${NET_FEE} KAS`]);
  }
  
  breakdownRows.push(["Purpose", tx.purpose]);

  return (
    <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:20}}>
      <Card p={28} style={{maxWidth:520, width:"100%", border:`1px solid ${C.warn}40`}}>
        <div style={{fontSize:14, color:C.warn, fontWeight:700, ...mono, marginBottom:4}}>⚠ TRANSACTION SIGNING REQUIRED</div>
        {hasMultiOutputs && (
          <div style={{fontSize:11, color:C.accent, ...mono, marginBottom:12, padding:"6px 10px", background:C.aLow, borderRadius:4}}>
            Multi-output transaction • Principal sent to agent deposit address
          </div>
        )}
        <Card p={0} style={{marginBottom:16}}>
          {breakdownRows.map(([k, v, extra], i, a)=>(
            <div key={k as string} style={{display:"flex", justifyContent:"space-between", padding:"9px 14px", borderBottom:i<a.length-1?`1px solid ${C.border}`:"none", flexWrap:"wrap", gap:"4px 8px"}}>
              <span style={{fontSize:12, color:C.dim, ...mono}}>{k}</span>
              <span style={{fontSize:12, color:C.text, ...mono, textAlign:"right"}}>
                {v}
                {extra && <span style={{display:"block", fontSize:10, color:C.dim}}>{extra}</span>}
              </span>
            </div>
          ))}
        </Card>
        {err && <div style={{fontSize:12, color:C.danger, ...mono, marginBottom:12, padding:"8px 12px", background:C.dLow, borderRadius:4}}>Error: {err}</div>}
        <div style={{display:"flex", gap:10}}>
          <Btn onClick={onReject} variant="ghost" style={{flex:1, padding:"10px 0"}}>REJECT</Btn>
          <Btn onClick={sign} disabled={busy} style={{flex:2, padding:"10px 0"}}>{busy?"SIGNING...":"SIGN & BROADCAST"}</Btn>
        </div>
        <div style={{fontSize:11, color:C.dim, marginTop:10, textAlign:"center", ...mono}}>
          Signing occurs client-side · Private key never leaves your wallet
        </div>
      </Card>
    </div>
  );
}
