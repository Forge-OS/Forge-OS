// Swap view for the main Forge-OS web app.
// Same DeFi UI as the extension SwapTab, adapted for full-width layout.
// Swap is in "coming soon" state until Kaspa native asset layer goes live.

import { useState } from "react";
import { C, mono } from "../tokens";

// ── Token definitions ─────────────────────────────────────────────────────────
interface Token { id: string; symbol: string; name: string; decimals: number; enabled: boolean; }

const TOKENS: Token[] = [
  { id: "KAS",  symbol: "KAS",  name: "Kaspa",     decimals: 8, enabled: true  },
  { id: "USDC", symbol: "USDC", name: "USD Coin",   decimals: 6, enabled: false },
  { id: "USDT", symbol: "USDT", name: "Tether USD", decimals: 6, enabled: false },
];

const TOKEN_LOGOS: Record<string, string> = {
  KAS:  "/kaspa-logo.png",
  USDC: "/usdc_white.png",
  USDT: "/usdt-logo.svg",
};

type KrcStandard = "krc20" | "krc721";

// ── TokenAvatar ───────────────────────────────────────────────────────────────
function TokenAvatar({ symbol, logoUri, size = 24 }: { symbol: string; logoUri?: string; size?: number }) {
  const src = logoUri ?? TOKEN_LOGOS[symbol];
  if (src) {
    return (
      <img
        src={src}
        alt={symbol}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "contain", flexShrink: 0, background: "rgba(57,221,182,0.08)" }}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: "rgba(57,221,182,0.18)", border: "1px solid rgba(57,221,182,0.35)",
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    }}>
      <span style={{ color: C.accent, fontSize: size * 0.42, fontWeight: 800 }}>{symbol.slice(0, 1)}</span>
    </div>
  );
}

function mainSwapAvatarSize(symbol: string | undefined): number {
  return 34;
}

function buildFallbackLogo(address: string): string {
  const short = String(address || "").trim().slice(0, 6).toUpperCase() || "KRC";
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0%' stop-color='#39DDB6'/><stop offset='100%' stop-color='#2D7BFF'/>` +
    `</linearGradient></defs>` +
    `<rect width='120' height='120' rx='24' fill='url(#g)'/>` +
    `<text x='60' y='66' text-anchor='middle' font-family='IBM Plex Mono, monospace' font-size='16' fill='white'>${short}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// ── SwapView ──────────────────────────────────────────────────────────────────
export function SwapView() {
  const [tokenIn,  setTokenIn]  = useState("KAS");
  const [tokenOut, setTokenOut] = useState("USDC");
  const [amountIn, setAmountIn] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [tokenSearch, setTokenSearch] = useState("");
  const [tokenStandard, setTokenStandard] = useState<KrcStandard>("krc20");
  const [tokenSelectMode, setTokenSelectMode] = useState<"from" | "to" | null>(null);
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [resolvedAddr, setResolvedAddr] = useState<string | null>(null);
  const [resolvedPreview, setResolvedPreview] = useState<{ symbol: string; logoUri?: string } | null>(null);

  const fromToken = TOKENS.find((t) => t.id === tokenIn) ?? TOKENS[0];
  const toToken   = TOKENS.find((t) => t.id === tokenOut) ?? null;

  const normalizedSearch = tokenSearch.trim().toLowerCase();
  const pickerResults = normalizedSearch
    ? TOKENS.filter((t) => `${t.symbol} ${t.name} ${t.id}`.toLowerCase().includes(normalizedSearch))
    : TOKENS;

  const closeTokenPicker = () => { setTokenSelectMode(null); setTokenSearch(""); setPasteError(null); setResolvedAddr(null); };

  const selectToken = (id: string) => {
    if (tokenSelectMode === "from") setTokenIn(id);
    else setTokenOut(id);
    closeTokenPicker();
  };

  const flipTokens = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
  };

  const pasteAndResolve = async () => {
    setPasteError(null);
    if (!navigator?.clipboard?.readText) { setPasteError("Clipboard unavailable."); return; }
    setPasteBusy(true);
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) { setPasteError("Clipboard is empty."); return; }
      setTokenSearch(text);
      setResolvedAddr(text);
      const lower = text.toLowerCase();
      const exact = TOKENS.find((t) => (
        t.id.toLowerCase() === lower
        || t.symbol.toLowerCase() === lower
        || t.name.toLowerCase() === lower
      ));
      if (exact) {
        setResolvedPreview({ symbol: exact.symbol, logoUri: TOKEN_LOGOS[exact.symbol] });
      } else {
        setResolvedPreview({
          symbol: text.slice(0, 6).toUpperCase(),
          logoUri: buildFallbackLogo(text),
        });
      }
    } catch { setPasteError("Failed to read clipboard."); }
    finally { setPasteBusy(false); }
  };

  // ── Shared card style ──────────────────────────────────────────────────────
  const card: React.CSSProperties = {
    background: "linear-gradient(155deg, rgba(14,20,29,0.97) 0%, rgba(10,15,22,0.94) 100%)",
    border: `1px solid rgba(28,42,58,0.9)`,
    borderRadius: 18,
    padding: "18px 20px 16px",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 10px 28px rgba(0,0,0,0.3)",
  };

  const tokenBtn = (hasToken: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 8,
    background: hasToken ? "rgba(24,34,48,0.95)" : `linear-gradient(90deg, rgba(57,221,182,0.12), rgba(57,221,182,0.06))`,
    border: `1px solid ${hasToken ? "rgba(28,42,58,0.9)" : "rgba(57,221,182,0.3)"}`,
    borderRadius: 999, padding: hasToken ? "8px 14px 8px 10px" : "8px 16px",
    color: hasToken ? C.text : C.accent,
    fontSize: 14, fontWeight: 700,
    cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap" as const,
    ...mono,
  });

  // ── Token picker screen ────────────────────────────────────────────────────
  if (tokenSelectMode !== null) {
    return (
      <div style={{ maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", gap: 0 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <button
            onClick={closeTokenPicker}
            style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 20, padding: 0 }}
          >←</button>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.text, letterSpacing: "0.02em" }}>Select a Token</span>
          <span style={{
            marginLeft: "auto", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em",
            color: C.accent, background: `${C.accent}15`, border: `1px solid ${C.accent}30`,
            borderRadius: 4, padding: "2px 8px", ...mono,
          }}>{tokenSelectMode.toUpperCase()}</span>
        </div>

        {/* Search + paste */}
        <div style={{
          display: "flex", alignItems: "center", gap: 0,
          background: "rgba(10,15,22,0.9)", border: `1px solid rgba(28,42,58,0.9)`,
          borderRadius: 14, overflow: "hidden", marginBottom: 12,
        }}>
          <span style={{ padding: "0 12px", color: C.dim, fontSize: 16, flexShrink: 0 }}>🔍</span>
          <input
            autoFocus
            value={tokenSearch}
              onChange={(e) => {
                setTokenSearch(e.target.value);
                setPasteError(null);
                setResolvedAddr(null);
                setResolvedPreview(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const first = pickerResults[0];
                  if (first) selectToken(first.id);
                }
              }}
              placeholder="Search name, symbol, or paste address…"
              style={{
                flex: 1, background: "none", border: "none", outline: "none",
                color: C.text, fontSize: 12, padding: "13px 0", ...mono,
            }}
          />
          <button
            onClick={pasteAndResolve}
            disabled={pasteBusy}
            style={{
              background: "rgba(57,221,182,0.1)", border: "none",
              borderLeft: `1px solid rgba(28,42,58,0.9)`,
              color: pasteBusy ? C.dim : C.accent, fontSize: 10, fontWeight: 700,
              letterSpacing: "0.1em", padding: "0 18px", height: "100%",
              cursor: pasteBusy ? "wait" : "pointer", ...mono,
            }}
          >{pasteBusy ? "…" : "PASTE"}</button>
        </div>

        {/* KRC standard tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {(["krc20", "krc721"] as KrcStandard[]).map((std) => {
            const active = tokenStandard === std;
            return (
              <button
                key={std}
                onClick={() => setTokenStandard(std)}
                style={{
                  flex: 1, padding: "6px 0", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
                  borderRadius: 8, cursor: "pointer",
                  background: active ? `${C.accent}15` : "rgba(16,25,35,0.5)",
                  border: `1px solid ${active ? `${C.accent}40` : "rgba(28,42,58,0.8)"}`,
                  color: active ? C.accent : C.dim, ...mono,
                }}
              >{std.toUpperCase()}</button>
            );
          })}
        </div>

        {pasteError && (
          <div style={{ fontSize: 10, color: C.danger, marginBottom: 10, padding: "8px 12px", background: `${C.danger}0D`, border: `1px solid ${C.danger}25`, borderRadius: 8 }}>
            {pasteError}
          </div>
        )}

        {resolvedAddr && (
          <div style={{
            marginBottom: 12, background: `${C.accent}0A`, border: `1px solid ${C.accent}30`,
            borderRadius: 12, padding: "12px 14px",
          }}>
            <div style={{ fontSize: 9, color: C.accent, letterSpacing: "0.1em", marginBottom: 6, ...mono }}>PASTED ADDRESS</div>
            {resolvedPreview && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <TokenAvatar symbol={resolvedPreview.symbol} logoUri={resolvedPreview.logoUri} size={30} />
                <div style={{ fontSize: 11, color: C.text, fontWeight: 700, ...mono }}>{resolvedPreview.symbol}</div>
              </div>
            )}
            <div style={{ fontSize: 11, color: C.dim, wordBreak: "break-all" as const }}>{resolvedAddr}</div>
            <div style={{ fontSize: 9, color: C.muted, marginTop: 6 }}>Token resolution available when swap goes live.</div>
          </div>
        )}

        {/* Token list */}
        {!normalizedSearch && (
          <div style={{ fontSize: 9, color: C.dim, letterSpacing: "0.1em", marginBottom: 10, ...mono }}>POPULAR TOKENS</div>
        )}
        {pickerResults.map((t, i) => (
          <button
            key={t.id}
            onClick={() => selectToken(t.id)}
            style={{
              width: "100%", background: "none", border: "none",
              display: "flex", alignItems: "center", gap: 14,
              padding: "11px 6px",
              borderBottom: i < pickerResults.length - 1 ? `1px solid rgba(28,42,58,0.5)` : "none",
              cursor: t.enabled ? "pointer" : "default",
              borderRadius: 0,
            }}
          >
            <TokenAvatar symbol={t.symbol} size={38} />
            <div style={{ flex: 1, textAlign: "left" }}>
              <div style={{ fontSize: 14, color: t.enabled ? C.text : C.dim, fontWeight: 700, ...mono }}>{t.symbol}</div>
              <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{t.name}</div>
            </div>
            {!t.enabled ? (
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: C.warn,
                background: `${C.warn}12`, border: `1px solid ${C.warn}30`, borderRadius: 4, padding: "2px 8px", ...mono,
              }}>SOON</span>
            ) : (tokenIn === t.id && tokenSelectMode === "from") || (tokenOut === t.id && tokenSelectMode === "to") ? (
              <span style={{ fontSize: 14, color: C.accent }}>✓</span>
            ) : null}
          </button>
        ))}

        {normalizedSearch && pickerResults.length === 0 && (
          <div style={{ textAlign: "center", padding: "32px 0", color: C.dim, fontSize: 11 }}>
            <div style={{ marginBottom: 8 }}>No token found.</div>
            <div style={{ fontSize: 10, color: C.muted }}>Paste a KRC20 contract address to add a custom token.</div>
          </div>
        )}
      </div>
    );
  }

  // ── Main swap UI ───────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", gap: 10 }}>

      {/* Coming soon banner */}
      <div style={{
        background: "rgba(143,123,255,0.08)", border: "1px solid rgba(143,123,255,0.2)",
        borderRadius: 12, padding: "10px 16px",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <span style={{ fontSize: 16, flexShrink: 0 }}>⏳</span>
        <div>
          <div style={{ fontSize: 10, color: "#8F7BFF", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 2, ...mono }}>SWAP COMING SOON</div>
          <div style={{ fontSize: 10, color: C.dim }}>KRC20 token swaps activate with Kaspa native asset layer. UI is live for preview.</div>
        </div>
      </div>

      {/* FROM card */}
      <div style={card}>
        <div style={{ fontSize: 12, color: C.dim, marginBottom: 14, letterSpacing: "0.04em" }}>from</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <button onClick={() => setTokenSelectMode("from")} style={tokenBtn(true)}>
            <TokenAvatar symbol={fromToken.symbol} size={mainSwapAvatarSize(fromToken.symbol)} />
            <span>{fromToken.symbol}</span>
            <span style={{ color: C.dim, fontSize: 12 }}>▾</span>
          </button>
        </div>
        <input
          type="number" min="0"
          value={amountIn}
          onChange={(e) => setAmountIn(e.target.value)}
          placeholder="0.00"
          style={{
            width: "100%", marginTop: 12, background: "none", border: "none", outline: "none",
            color: C.text, fontSize: 30, fontWeight: 600, textAlign: "center",
            ...mono,
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
          <div style={{ fontSize: 11, color: C.dim, display: "flex", alignItems: "center", gap: 5 }}>
            <span>Balance: 0 {fromToken.symbol}</span>
          </div>
          <button style={{
            background: `${C.accent}12`, border: `1px solid ${C.accent}30`, borderRadius: 6,
            color: C.accent, fontSize: 10, fontWeight: 700, padding: "3px 10px", cursor: "pointer",
            letterSpacing: "0.06em", ...mono,
          }}>MAX</button>
        </div>
      </div>

      {/* Flip button */}
      <div style={{ display: "flex", justifyContent: "center", margin: "-6px 0", zIndex: 1 }}>
        <button
          onClick={flipTokens}
          style={{
            background: "rgba(14,20,29,0.98)", border: `1px solid rgba(28,42,58,0.9)`,
            borderRadius: "50%", width: 36, height: 36,
            color: C.text, fontSize: 18,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}
        >⇅</button>
      </div>

      {/* TO card */}
      <div style={card}>
        <div style={{ fontSize: 12, color: C.dim, marginBottom: 14, letterSpacing: "0.04em" }}>to</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          {toToken ? (
            <button onClick={() => setTokenSelectMode("to")} style={tokenBtn(true)}>
              <TokenAvatar symbol={toToken.symbol} size={mainSwapAvatarSize(toToken.symbol)} />
              <span>{toToken.symbol}</span>
              <span style={{ color: C.dim, fontSize: 12 }}>▾</span>
            </button>
          ) : (
            <button onClick={() => setTokenSelectMode("to")} style={tokenBtn(false)}>
              <span>Select Token</span>
              <span style={{ fontSize: 12 }}>▾</span>
            </button>
          )}
        </div>
        <div style={{ width: "100%", marginTop: 12, textAlign: "center", color: C.dim, fontSize: 30, fontWeight: 600, ...mono }}>
          0.00
        </div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 12, display: "flex", alignItems: "center", gap: 5 }}>
          <span>Balance: 0 {toToken?.symbol ?? ""}</span>
        </div>
      </div>

      {/* Rate + slippage row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 2px" }}>
        <div style={{ fontSize: 11, color: C.dim }}>
          Rate: <span style={{ color: C.text }}>1 {fromToken.symbol} ≈ — {toToken?.symbol ?? "—"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: C.dim }}>Slippage</span>
          <div style={{ display: "flex", gap: 4 }}>
            {[25, 50, 100].map((bps) => {
              const active = slippageBps === bps;
              return (
                <button
                  key={bps}
                  onClick={() => setSlippageBps(bps)}
                  style={{
                    padding: "4px 9px", borderRadius: 7, fontSize: 10, fontWeight: 700,
                    background: active ? `${C.accent}20` : "rgba(22,32,45,0.8)",
                    border: `1px solid ${active ? `${C.accent}50` : "rgba(28,42,58,0.8)"}`,
                    color: active ? C.accent : C.dim,
                    cursor: "pointer", ...mono,
                  }}
                >{(bps / 100).toFixed(1)}%</button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Swap button */}
      <button
        disabled
        style={{
          width: "100%", padding: "16px 0",
          background: "rgba(33,48,67,0.55)",
          color: C.dim, border: "none",
          borderRadius: 16, fontSize: 13, fontWeight: 700,
          letterSpacing: "0.08em", cursor: "not-allowed", ...mono,
        }}
      >
        SWAP COMING SOON
      </button>

      {/* Info */}
      <div style={{
        background: "rgba(10,15,22,0.7)", border: `1px solid rgba(28,42,58,0.8)`,
        borderRadius: 12, padding: "12px 14px",
      }}>
        <div style={{ fontSize: 9, color: C.dim, letterSpacing: "0.1em", marginBottom: 8, ...mono }}>HOW IT WORKS</div>
        {[
          "KRC20 token swaps activate with the Kaspa native asset layer.",
          "Paste any KRC20/KRC721 contract address in the token picker.",
          "Non-custodial — keys never leave your device or the extension vault.",
          "AES-256-GCM encrypted vault, Argon2id KDF (legacy PBKDF2 vaults auto-migrate).",
        ].map((note, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: i < 3 ? 5 : 0 }}>
            <span style={{ color: C.accent, fontSize: 10, flexShrink: 0 }}>›</span>
            <span style={{ fontSize: 10, color: C.muted, lineHeight: 1.5 }}>{note}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
