import { useCallback, useEffect, useState } from "react";
import { ALLOWED_ADDRESS_PREFIXES, DEFAULT_NETWORK, EXPLORER, KAS_API, NET_FEE, NETWORK_LABEL, RESERVE } from "../../constants";
import { fmt, isKaspaAddress, shortAddr } from "../../helpers";
import { kasBalance, kasPrice, kasUtxos } from "../../api/kaspaApi";
import { C, mono } from "../../tokens";
import { WalletAdapter } from "../../wallet/WalletAdapter";
import { SigningModal } from "../SigningModal";
import { Badge, Btn, Card, ExtLink, Inp, Label } from "../ui";

export function WalletPanel({agent, wallet, kasData}: any) {
  const [liveKas, setLiveKas] = useState(null as any);
  const [utxos, setUtxos] = useState([] as any[]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null as any);
  const [fetched, setFetched] = useState(null as any);
  const [signingTx, setSigningTx] = useState(null as any);
  const [withdrawTo, setWithdrawTo] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [note, setNote] = useState("");
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());
  const [viewportWidth, setViewportWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1200
  );

  // Get price from kasData or fetch fresh
  const priceUsd = Number(kasData?.priceUsd || 0);
  const priceChange24h = Number(kasData?.change24h || 0);
  
  const refresh = useCallback(async()=>{
    setLoading(true); setErr(null);
    try{
      let b;
      if(wallet?.provider==="kasware"){b = await WalletAdapter.getKaswareBalance();}
      else{const r = await kasBalance(wallet?.address||agent.wallet); b = r.kas;}
      const u = await kasUtxos(wallet?.address||agent.wallet);
      setLiveKas(b);
      setUtxos(Array.isArray(u)?u.slice(0,10):[]);
      setFetched(new Date());
      setLastRefresh(Date.now());
    }catch(e: any){setErr(e.message);}
    setLoading(false);
  },[wallet,agent]);

  useEffect(()=>{refresh();},[refresh]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      refresh();
    }, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  const bal = parseFloat(liveKas ?? agent.capitalLimit ?? 0);
  const maxSendKas = Math.max(0, bal - RESERVE - NET_FEE);
  const maxSend = maxSendKas.toFixed(4);
  const isMobile = viewportWidth < 760;
  
  // Calculate USD value
  const balanceUsd = priceUsd > 0 ? (bal * priceUsd) : null;
  const spendableKas = Math.max(0, bal - RESERVE - NET_FEE);
  const spendableUsd = priceUsd > 0 ? (spendableKas * priceUsd) : null;
  
  // Time since last refresh
  const timeSinceRefresh = Math.floor((Date.now() - lastRefresh) / 1000);
  const refreshLabel = timeSinceRefresh < 60 ? `${timeSinceRefresh}s ago` : 
                      timeSinceRefresh < 3600 ? `${Math.floor(timeSinceRefresh/60)}m ago` : 
                      `${Math.floor(timeSinceRefresh/3600)}h ago`;

  const initiateWithdraw = () => {
    const requested = Number(withdrawAmt);
    if(!isKaspaAddress(withdrawTo, ALLOWED_ADDRESS_PREFIXES) || !(requested > 0) || requested > maxSendKas) return;
    setSigningTx({
      type:"WITHDRAW",
      from:wallet?.address,
      to:withdrawTo,
      amount_kas:Number(requested.toFixed(6)),
      purpose:note || "Withdrawal",
    });
  };
  const handleSigned = () => {setSigningTx(null); setWithdrawTo(""); setWithdrawAmt(""); setNote("");};

  // Format currency
  const fmtUsd = (v: number | null) => {
    if (v === null) return "—";
    return v >= 1 ? `$${v.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : `$${v.toFixed(4)}`;
  };

  return(
    <div>
      {signingTx && <SigningModal tx={signingTx} wallet={wallet} onSign={handleSigned} onReject={()=>setSigningTx(null)}/>}
      
      {/* PRO MINI WALLET - Enhanced Header */}
      <Card p={0} style={{marginBottom:16, background:`linear-gradient(135deg, ${C.s2} 0%, ${C.s1} 100%)`, border:`1px solid ${C.accent}30`, overflow:"hidden", boxShadow:`0 4px 24px ${C.accent}15`}}>
        {/* Gradient accent bar with LIVE indicator */}
        <div style={{height:4, background:`linear-gradient(90deg, ${C.accent}, ${C.purple})`, position:"relative"}}>
          <div style={{
            position:"absolute", right:12, top:-6,
            background:C.ok, color:C.s1, fontSize:9, fontWeight:700,
            padding:"2px 8px", borderRadius:4, ...mono,
            display:"flex", alignItems:"center", gap:4,
            boxShadow:"0 0 8px #4ade80"
          }}>
            <span style={{
              width:6, height:6, background:C.s1, borderRadius:"50%",
              animation:"pulse 1.5s infinite"
            }} />
            LIVE
          </div>
        </div>
        
        <div style={{padding:20}}>
          {/* Wallet Header */}
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16}}>
            <div style={{display:"flex", alignItems:"center", gap:10}}>
              <div style={{
                width:42, height:42, borderRadius:10, 
                background:`linear-gradient(135deg, ${C.accent}20, ${C.purple}20)`,
                border:`1px solid ${C.accent}40`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:18
              }}>
                💎
              </div>
              <div>
                <div style={{fontSize:11, color:C.dim, ...mono, letterSpacing:"0.08em"}}>MINI WALLET</div>
                <div style={{fontSize:13, color:C.text, fontWeight:600, ...mono}}>
                  {wallet?.provider === "kasware" ? "KasWare" : 
                   wallet?.provider === "kastle" ? "Kastle" :
                   wallet?.provider === "ghost" ? "Ghost" :
                   wallet?.provider?.toUpperCase() || "WALLET"}
                </div>
              </div>
            </div>
            <div style={{display:"flex", gap:6, alignItems:"center"}}>
              <Badge
                text={wallet?.provider==="demo"?"DEMO":String(wallet?.provider || "").toUpperCase()}
                color={["kasware","kastle","ghost"].includes(String(wallet?.provider || "")) ? C.ok : C.warn}
                dot
              />
            </div>
          </div>
          
          {/* Balance Display - PRO STYLE */}
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11, color:C.dim, ...mono, marginBottom:4}}>TOTAL BALANCE</div>
            <div style={{display:"flex", alignItems:"baseline", gap:12, flexWrap:"wrap"}}>
              <span style={{fontSize:36, color:C.accent, fontWeight:700, ...mono, lineHeight:1.1}}>
                {liveKas !== null ? fmt(liveKas, 4) : "—"}
              </span>
              <span style={{fontSize:18, color:C.dim, ...mono}}>KAS</span>
              {balanceUsd !== null && (
                <span style={{fontSize:18, color:C.text, ...mono, marginLeft:4}}>
                  ≈ {fmtUsd(balanceUsd)}
                </span>
              )}
            </div>
          </div>
          
          {/* Stats Grid - Enhanced */}
          <div style={{display:"grid", gridTemplateColumns:isMobile ? "1fr 1fr" : "1fr 1fr 1fr", gap:12, marginBottom:16}}>
            <div style={{background:C.dLow, borderRadius:8, padding:12, border:`1px solid ${C.border}50`}}>
              <div style={{fontSize:10, color:C.dim, ...mono, marginBottom:4, display:"flex", justifyContent:"space-between"}}>
                SPENDABLE
                <span style={{color:C.ok, fontSize:9}}>✓</span>
              </div>
              <div style={{fontSize:16, color:C.ok, fontWeight:700, ...mono}}>
                {liveKas !== null ? fmt(spendableKas, 4) : "—"} <span style={{fontSize:11, color:C.dim}}>KAS</span>
              </div>
              {spendableUsd !== null && (
                <div style={{fontSize:11, color:C.dim, ...mono}}>{fmtUsd(spendableUsd)}</div>
              )}
            </div>
            <div style={{background:C.dLow, borderRadius:8, padding:12, border:`1px solid ${C.border}50`}}>
              <div style={{fontSize:10, color:C.dim, ...mono, marginBottom:4}}>RESERVE</div>
              <div style={{fontSize:16, color:C.text, fontWeight:700, ...mono}}>
                {RESERVE} <span style={{fontSize:11, color:C.dim}}>KAS</span>
              </div>
            </div>
            <div style={{background:C.dLow, borderRadius:8, padding:12, border:`1px solid ${C.border}50`}}>
              <div style={{fontSize:10, color:C.dim, ...mono, marginBottom:4}}>KAS PRICE</div>
              <div style={{fontSize:16, color:C.text, fontWeight:700, ...mono}}>
                {priceUsd > 0 ? `$${priceUsd.toFixed(4)}` : "—"}
              </div>
              {priceChange24h !== 0 && (
                <div style={{fontSize:11, color:priceChange24h >= 0 ? C.ok : C.danger, ...mono}}>
                  {priceChange24h >= 0 ? "↑" : "↓"} {Math.abs(priceChange24h).toFixed(2)}% 24h
                </div>
              )}
            </div>
          </div>
          
          {/* Address & Actions */}
          <div style={{background:C.s2, borderRadius:8, padding:12, marginBottom:12, border:`1px solid ${C.border}50`}}>
            <div style={{fontSize:10, color:C.dim, ...mono, marginBottom:6, display:"flex", justifyContent:"space-between"}}>
              CONNECTED ADDRESS
              <span style={{color:C.accent, fontSize:10}}>{refreshLabel}</span>
            </div>
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
              <div style={{fontSize:12, color:C.accent, ...mono, wordBreak:"break-all", flex:1, marginRight:12}}>
                {wallet?.address ? shortAddr(wallet.address) : "—"}
              </div>
              <div style={{display:"flex", gap:6}}>
                <Btn onClick={()=>navigator.clipboard?.writeText(wallet?.address || "")} variant="ghost" size="sm">COPY</Btn>
                <ExtLink href={`${EXPLORER}/addresses/${wallet?.address}`} label="EXPLORER ↗"/>
              </div>
            </div>
          </div>
          
          {/* Quick Actions */}
          <div style={{display:"flex", gap:8}}>
            <Btn onClick={refresh} disabled={loading} variant="ghost" style={{flex:1, padding:"10px 0"}}>
              {loading ? "↻ LOADING..." : "↻ REFRESH BALANCE"}
            </Btn>
          </div>
        </div>
        
        {/* Error Display */}
        {err && (
          <div style={{
            background:C.danger + "15", borderTop:`1px solid ${C.danger}40`, 
            padding:"10px 20px", fontSize:11, color:C.danger, ...mono
          }}>
            ⚠ RPC Error: {err}
          </div>
        )}
      </Card>

      {/* Network & UTXO Summary */}
      <div style={{display:"grid", gridTemplateColumns:isMobile ? "1fr" : "repeat(3,1fr)", gap:12, marginBottom:16}}>
        <Card p={14} style={{textAlign:"center", border:`1px solid ${C.border}50`}}>
          <div style={{fontSize:10, color:C.dim, ...mono, marginBottom:4}}>NETWORK</div>
          <div style={{fontSize:14, color:C.text, fontWeight:600, ...mono}}>{NETWORK_LABEL}</div>
        </Card>
        <Card p={14} style={{textAlign:"center", border:`1px solid ${C.border}50`}}>
          <div style={{fontSize:10, color:C.dim, ...mono, marginBottom:4}}>UTXO COUNT</div>
          <div style={{fontSize:14, color:utxos.length > 0 ? C.ok : C.warn, fontWeight:600, ...mono}}>
            {liveKas !== null ? utxos.length : "—"}
          </div>
        </Card>
        <Card p={14} style={{textAlign:"center", border:`1px solid ${C.border}50`}}>
          <div style={{fontSize:10, color:C.dim, ...mono, marginBottom:4}}>LAST SYNC</div>
          <div style={{fontSize:14, color:C.text, fontWeight:600, ...mono}}>
            {fetched ? fetched.toLocaleTimeString() : "—"}
          </div>
        </Card>
      </div>

      {/* Withdraw */}
      <Card p={20} style={{marginBottom:12, border:`1px solid ${C.border}50`}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12}}>
          <Label style={{marginBottom:0}}>Withdraw KAS</Label>
          <Badge text="TRANSFER" color={C.dim} />
        </div>
        <div style={{background:C.s2, borderRadius:4, padding:"9px 13px", marginBottom:12, display:"flex", justifyContent:"space-between", border:`1px solid ${C.ok}30`}}>
          <span style={{fontSize:11, color:C.dim, ...mono}}>Available (after {RESERVE} KAS reserve)</span>
          <span style={{fontSize:14, color:C.ok, fontWeight:700, ...mono}}>{maxSend} KAS</span>
        </div>
        <Inp label="Recipient Address" value={withdrawTo} onChange={setWithdrawTo} placeholder="kaspa:... or kaspatest:..."/>
        <div style={{display:"grid", gridTemplateColumns:isMobile ? "1fr" : "1fr auto", gap:8, alignItems:"flex-end", marginBottom:12}}>
          <Inp label={`Amount (max ${maxSend} KAS)`} value={withdrawAmt} onChange={setWithdrawAmt} type="number" suffix="KAS" placeholder="0.0000"/>
          <Btn onClick={()=>setWithdrawAmt(maxSend)} variant="ghost" size="sm" style={{marginBottom:1}}>MAX</Btn>
        </div>
        <Inp label="Note (optional)" value={note} onChange={setNote} placeholder="e.g. Profit extraction"/>
        <Btn
          onClick={initiateWithdraw}
          disabled={
            !isKaspaAddress(withdrawTo, ALLOWED_ADDRESS_PREFIXES) ||
            !(Number(withdrawAmt) > 0) ||
            Number(withdrawAmt) > maxSendKas
          }
          style={{width:"100%", padding:"10px 0", marginTop:8}}
        >
          INITIATE WITHDRAWAL — SIGN WITH {wallet?.provider?.toUpperCase()||"WALLET"}
        </Btn>
        {Number(withdrawAmt || 0) > maxSendKas && (
          <div style={{fontSize:11, color:C.warn, marginTop:6, ...mono}}>
            Requested withdrawal exceeds available amount after reserve and network fee.
          </div>
        )}
      </Card>

      {/* Deposit */}
      <Card p={20} style={{marginBottom:12, border:`1px solid ${C.border}50`}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12}}>
          <Label style={{marginBottom:0}}>Deposit KAS</Label>
          <Badge text="RECEIVE" color={C.accent} />
        </div>
        <div style={{fontSize:12, color:C.dim, marginBottom:12}}>Send KAS directly to your connected wallet address. Funds are available after DAG confirmation (~1–2s).</div>
        <div style={{background:C.s2, borderRadius:4, padding:14, border:`1px solid ${C.accent}25`}}>
          <div style={{fontSize:12, color:C.accent, ...mono, wordBreak:"break-all", marginBottom:10}}>{wallet?.address || "—"}</div>
          <ExtLink href={`${EXPLORER}/addresses/${wallet?.address}`} label="VIEW ON KASPA EXPLORER ↗"/>
        </div>
      </Card>

      {/* UTXOs */}
      {utxos.length>0 && (
        <Card p={0}>
          <div style={{padding:"11px 16px", borderBottom:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", background:C.s2 + "50"}}>
            <span style={{fontSize:11, color:C.dim, ...mono}}>UTXO SET — {utxos.length} outputs</span>
            <span style={{fontSize:10, color:C.ok, ...mono}}>CONFIRMED</span>
          </div>
          {utxos.map((u: any, i: number)=>{
            const kas = fmt((u.utxoEntry?.amount||0)/1e8,4);
            const daa = u.utxoEntry?.blockDaaScore;
            const txid = u.outpoint?.transactionId;
            return(
              <div key={i} style={{display:"grid", gridTemplateColumns:isMobile ? "1fr" : "1fr 100px 120px 60px", gap:8, padding:"10px 16px", borderBottom:`1px solid ${C.border}`, alignItems:"center", background:i % 2 === 0 ? "transparent" : C.s1 + "30"}}>
                <span style={{fontSize:11, color:C.dim, ...mono, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{txid?.slice(0,34)}...</span>
                <span style={{fontSize:12, color:C.ok, fontWeight:700, ...mono, textAlign:isMobile ? "left" : "right"}}>{kas} KAS</span>
                <span style={{fontSize:11, color:C.dim, ...mono, textAlign:isMobile ? "left" : "right"}}>DAA {daa}</span>
                <div style={{textAlign:isMobile ? "left" : "right"}}><ExtLink href={`${EXPLORER}/txs/${txid}`} label="↗"/></div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

