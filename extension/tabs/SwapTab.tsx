// Swap Tab — gated UI.
// Renders in disabled state when SWAP_CONFIG.enabled = false.
// All interactive elements are present but non-functional (clearly labelled).
// No fake quotes, no simulated swaps, no placeholder amounts.

import { useEffect, useState } from "react";
import { C, mono } from "../../src/tokens";
import {
  SWAP_CONFIG,
  type KaspaTokenStandard,
  type SwapCustomToken,
  type SwapQuote,
} from "../swap/types";
import {
  connectEvmSidecarSigner,
  executeSwapQuote,
  getSwapGatingStatus,
  getSwapQuote,
  recoverPendingSwapSettlements,
} from "../swap/swap";
import { getConfiguredSwapRouteInfo } from "../swap/routeSource";
import { getAllTokens } from "../tokens/registry";
import type { TokenId } from "../tokens/types";
import { clearEvmSidecarSession, getEvmSidecarSession, type EvmSidecarSession } from "../swap/evmSidecar";
import { listSwapSettlements } from "../swap/settlementStore";
import type { SwapSettlementRecord } from "../swap/settlement";
import { getNetwork } from "../shared/storage";
import { resolveTokenFromAddress } from "../swap/tokenResolver";
import {
  insetCard,
  outlineButton,
  popupTabStack,
  primaryButton,
  sectionCard,
  sectionKicker,
} from "../popup/surfaces";

// Logo paths relative to popup HTML (extension/popup/index.html)
const TOKEN_LOGOS: Partial<Record<string, string>> = {
  KAS:  "../icons/kaspa-logo.png",
  USDC: "../icons/usdc.png",
  USDT: "../icons/usdt.png",
};

function TokenAvatar({ symbol, logoUri, size = 22 }: { symbol: string; logoUri?: string; size?: number }) {
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
      <span style={{ color: "#39DDB6", fontSize: size * 0.45, fontWeight: 800 }}>
        {symbol.slice(0, 1)}
      </span>
    </div>
  );
}

function parseAmountToUnits(value: string, decimals: number): bigint | null {
  const v = String(value || "").trim();
  if (!v || !/^\d+(\.\d+)?$/.test(v)) return null;
  const [whole, frac = ""] = v.split(".");
  const wholePart = whole.replace(/^0+(?=\d)/, "") || "0";
  const fracPart = frac.slice(0, decimals).padEnd(decimals, "0");
  const digits = `${wholePart}${fracPart}`.replace(/^0+(?=\d)/, "") || "0";
  try {
    return BigInt(digits);
  } catch {
    return null;
  }
}

export function SwapTab() {
  const [sidecarSession, setSidecarSession] = useState<EvmSidecarSession | null>(() => getEvmSidecarSession());
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [settlements, setSettlements] = useState<SwapSettlementRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connectBusy, setConnectBusy] = useState(false);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [executeBusy, setExecuteBusy] = useState(false);
  const [showConnectConsent, setShowConnectConsent] = useState(false);
  const [showExecuteConsent, setShowExecuteConsent] = useState(false);

  const gating = getSwapGatingStatus();
  const routeInfo = getConfiguredSwapRouteInfo();
  const tokens = getAllTokens();

  const [tokenIn, setTokenIn] = useState<TokenId>("KAS");
  const [tokenOut, setTokenOut] = useState<TokenId>("USDC");
  const [amountIn, setAmountIn] = useState("");
  const [slippageBps, setSlippageBps] = useState(SWAP_CONFIG.defaultSlippageBps);
  const [tokenSearch, setTokenSearch] = useState("");
  const [tokenStandard, setTokenStandard] = useState<KaspaTokenStandard>("krc20");
  const [resolvedToken, setResolvedToken] = useState<SwapCustomToken | null>(null);
  const [tokenResolveBusy, setTokenResolveBusy] = useState(false);
  const [tokenResolveError, setTokenResolveError] = useState<string | null>(null);
  const [tokenClipboardBusy, setTokenClipboardBusy] = useState(false);
  const [tokenAddressCopied, setTokenAddressCopied] = useState(false);
  const [sliderPct, setSliderPct] = useState(0);
  const [showTokenSearch, setShowTokenSearch] = useState(false);

  const isDisabled = !gating.enabled;
  const evmRoute = SWAP_CONFIG.routeSource === "evm_0x";
  const normalizedTokenSearch = tokenSearch.trim().toLowerCase();
  const tokenSearchResults = normalizedTokenSearch
    ? tokens
      .filter((t) => `${t.symbol} ${t.name} ${t.id}`.toLowerCase().includes(normalizedTokenSearch))
      .slice(0, 8)
    : [];
  const selectedListedTokenOut = tokens.find((t) => t.id === tokenOut) ?? null;

  useEffect(() => {
    setSidecarSession(getEvmSidecarSession());
    recoverPendingSwapSettlements().catch(() => {});
    listSwapSettlements().then(setSettlements).catch(() => {});
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      recoverPendingSwapSettlements()
        .then(() => listSwapSettlements().then((items) => setSettlements(items.slice(0, 4))))
        .catch(() => {});
    }, SWAP_CONFIG.settlementPollIntervalMs);
    return () => clearInterval(id);
  }, []);

  const refreshSettlements = async () => {
    const items = await listSwapSettlements();
    setSettlements(items.slice(0, 4));
  };

  const resetQuoteState = () => {
    setQuote(null);
    setError(null);
    setShowExecuteConsent(false);
  };

  const requestQuote = async () => {
    setError(null);
    const tokenMeta = tokens.find((t) => t.id === tokenIn);
    const units = parseAmountToUnits(amountIn, tokenMeta?.decimals ?? 8);
    if (!units || units <= 0n) {
      setError("Enter a valid amount.");
      return;
    }
    setQuoteBusy(true);
    try {
      const q = await getSwapQuote({
        tokenIn,
        tokenOut,
        amountIn: units,
        slippageBps,
        customTokenOut: resolvedToken,
      });
      if (!q) {
        setError(gating.reason ?? "Swap is currently unavailable.");
        return;
      }
      setQuote(q);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setQuoteBusy(false);
    }
  };

  const resolveCustomTokenFromAddress = async (addressRaw: string) => {
    setTokenResolveError(null);
    setError(null);
    const trimmed = String(addressRaw || "").trim();
    if (!trimmed) {
      setTokenResolveError("Paste a token address first.");
      return;
    }
    setTokenResolveBusy(true);
    try {
      const network = await getNetwork().catch(() => "mainnet");
      const token = await resolveTokenFromAddress(trimmed, tokenStandard, network);
      setTokenSearch(trimmed);
      setResolvedToken(token);
      setTokenOut("USDC");
      setTokenAddressCopied(false);
      resetQuoteState();
    } catch (err) {
      setResolvedToken(null);
      setTokenResolveError(err instanceof Error ? err.message : String(err));
    } finally {
      setTokenResolveBusy(false);
    }
  };

  const clearResolvedToken = () => {
    setResolvedToken(null);
    setTokenResolveError(null);
    setTokenAddressCopied(false);
    resetQuoteState();
  };

  const pasteAndResolveTokenAddress = async () => {
    setTokenResolveError(null);
    setError(null);
    if (!navigator?.clipboard?.readText) {
      setTokenResolveError("Clipboard read is unavailable in this browser.");
      return;
    }
    setTokenClipboardBusy(true);
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();
      if (!trimmed) {
        setTokenResolveError("Clipboard is empty.");
        return;
      }
      setShowTokenSearch(true);
      await resolveCustomTokenFromAddress(trimmed);
    } catch (err) {
      setTokenResolveError(err instanceof Error ? err.message : "Failed to read clipboard.");
    } finally {
      setTokenClipboardBusy(false);
    }
  };

  const selectListedTokenOut = (id: TokenId) => {
    setTokenOut(id);
    setResolvedToken(null);
    setTokenResolveError(null);
    setTokenAddressCopied(false);
    setTokenSearch("");
    resetQuoteState();
  };

  const runTokenSearch = async () => {
    setTokenResolveError(null);
    setError(null);
    const trimmed = tokenSearch.trim();
    if (!trimmed) {
      setTokenResolveError("Type a token name/symbol or paste a token address.");
      return;
    }
    const lower = trimmed.toLowerCase();
    const exact = tokens.find((t) => (
      t.id.toLowerCase() === lower
      || t.symbol.toLowerCase() === lower
      || t.name.toLowerCase() === lower
    ));
    if (exact) {
      if (!exact.enabled) {
        setTokenResolveError(exact.disabledReason ?? `${exact.symbol} is not currently available.`);
        return;
      }
      selectListedTokenOut(exact.id);
      return;
    }
    await resolveCustomTokenFromAddress(trimmed);
  };

  const copyResolvedTokenAddress = async () => {
    if (!resolvedToken?.address) return;
    if (!navigator?.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(resolvedToken.address);
      setTokenAddressCopied(true);
      setTimeout(() => setTokenAddressCopied(false), 1400);
    } catch {
      // no-op: keep UX fail-safe
    }
  };

  const connectSidecar = async () => {
    setError(null);
    setConnectBusy(true);
    try {
      const session = await connectEvmSidecarSigner();
      setSidecarSession(session);
      setShowConnectConsent(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnectBusy(false);
    }
  };

  const disconnectSidecar = () => {
    clearEvmSidecarSession();
    setSidecarSession(null);
  };

  const executeQuote = async () => {
    if (!quote) return;
    setError(null);
    setExecuteBusy(true);
    try {
      await executeSwapQuote(quote);
      setShowExecuteConsent(false);
      await refreshSettlements();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExecuteBusy(false);
    }
  };

  const flipSwapDirection = () => {
    const enabledInputIds = new Set(tokens.filter((t) => t.enabled).map((t) => t.id));
    if (!enabledInputIds.has(tokenOut)) {
      setError(`Cannot flip while ${tokenOut} is disabled for input.`);
      return;
    }
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    clearResolvedToken();
    resetQuoteState();
  };

  // Token pill for "from" — overlays a hidden <select> so native token switching still works
  const fromToken = tokens.find((t) => t.id === tokenIn);
  const toTokenMeta = resolvedToken
    ? { symbol: resolvedToken.symbol, name: resolvedToken.name }
    : selectedListedTokenOut ?? null;

  const swapCard: React.CSSProperties = {
    background: "linear-gradient(155deg, rgba(14,20,29,0.96) 0%, rgba(10,15,22,0.92) 100%)",
    border: `1px solid ${C.border}`,
    borderRadius: 16,
    padding: "14px 16px",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 20px rgba(0,0,0,0.28)",
  };

  const tokenPill = (symbol: string, placeholder = false): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "rgba(22,32,45,0.9)",
    border: `1px solid ${placeholder ? C.border : C.border}`,
    borderRadius: 999,
    padding: "6px 10px 6px 7px",
    color: placeholder ? C.dim : C.text,
    fontSize: 12,
    fontWeight: 600,
    cursor: isDisabled ? "not-allowed" : "pointer",
    flexShrink: 0,
    whiteSpace: "nowrap" as const,
    ...mono,
  });

  return (
    <div style={{ ...popupTabStack, gap: 8 }}>

      {/* ── Disabled banner ── */}
      {isDisabled && (
        <div style={{ ...sectionCard("purple"), display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>⏳</span>
          <div>
            <div style={{ fontSize: 9, color: C.purple, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 3 }}>
              SWAP UNAVAILABLE
            </div>
            <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.5 }}>
              {gating.reason ?? "Swap functionality not yet active on Kaspa."}
            </div>
          </div>
        </div>
      )}

      {/* ── EVM sidecar ── */}
      {evmRoute && (
        <div style={sectionCard("default", true)}>
          <div style={{ ...sectionKicker, marginBottom: 6 }}>EVM SIDECAR SIGNER</div>
          {sidecarSession ? (
            <>
              <div style={{ fontSize: 8, color: C.text, marginBottom: 6 }}>
                Connected: {sidecarSession.address.slice(0, 8)}…{sidecarSession.address.slice(-6)} (chain {sidecarSession.chainId})
              </div>
              <button onClick={disconnectSidecar} style={{ ...outlineButton(C.warn), width: "100%", padding: "8px 0" }}>
                DISCONNECT EVM SIGNER
              </button>
            </>
          ) : !showConnectConsent ? (
            <button
              onClick={() => setShowConnectConsent(true)}
              style={{ ...outlineButton(C.accent), width: "100%", padding: "8px 0" }}
              disabled={connectBusy}
            >
              CONNECT METAMASK SIDECAR
            </button>
          ) : (
            <div style={{ ...insetCard(), padding: "8px 10px" }}>
              <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.5, marginBottom: 6 }}>
                Connecting an EVM signer. Forge-OS Kaspa keys are not shared.
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={connectSidecar} style={{ ...primaryButton(true), flex: 1, padding: "7px 0" }} disabled={connectBusy}>
                  {connectBusy ? "CONNECTING…" : "I AGREE, CONNECT"}
                </button>
                <button onClick={() => setShowConnectConsent(false)} style={{ ...outlineButton(C.dim), flex: 1, padding: "7px 0" }} disabled={connectBusy}>
                  CANCEL
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── FROM card ── */}
      <div style={swapCard}>
        {/* Header row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: C.dim, letterSpacing: "0.04em" }}>from</span>
          <span style={{ fontSize: 11, color: C.dim }}>{sliderPct}%</span>
        </div>

        {/* Percentage slider */}
        <input
          type="range"
          min={0}
          max={100}
          value={sliderPct}
          disabled={isDisabled}
          onChange={(e) => setSliderPct(Number(e.target.value))}
          style={{
            width: "100%",
            marginBottom: 14,
            accentColor: C.accent,
            cursor: isDisabled ? "not-allowed" : "pointer",
            height: 3,
          }}
        />

        {/* Token selector + amount */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Token pill with overlaid hidden <select> */}
          <div style={{ position: "relative", flexShrink: 0 }}>
            <div style={tokenPill(fromToken?.symbol ?? "KAS")}>
              <TokenAvatar symbol={fromToken?.symbol ?? "KAS"} />
              <span>{fromToken?.symbol ?? "KAS"}</span>
              <span style={{ color: C.dim, fontSize: 10 }}>›</span>
            </div>
            <select
              value={tokenIn}
              onChange={(e) => { setTokenIn(e.target.value as TokenId); resetQuoteState(); }}
              disabled={isDisabled}
              style={{
                position: "absolute", inset: 0, opacity: 0,
                width: "100%", height: "100%",
                cursor: isDisabled ? "not-allowed" : "pointer",
              }}
            >
              {tokens.filter((t) => t.enabled).map((t) => (
                <option key={t.id} value={t.id}>{t.symbol}</option>
              ))}
            </select>
          </div>

          {/* Amount input */}
          <input
            type="number"
            min="0"
            value={amountIn}
            onChange={(e) => setAmountIn(e.target.value)}
            placeholder="0"
            disabled={isDisabled}
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              color: isDisabled ? C.dim : C.text,
              fontSize: 26,
              fontWeight: 600,
              textAlign: "right",
              cursor: isDisabled ? "not-allowed" : "text",
              ...mono,
            }}
          />
        </div>

        {/* Balance */}
        <div style={{ fontSize: 10, color: C.dim, marginTop: 10, display: "flex", alignItems: "center", gap: 4 }}>
          <span>🪙</span>
          <span>0</span>
        </div>
      </div>

      {/* ── Flip arrow ── */}
      <div style={{ display: "flex", justifyContent: "center", margin: "-4px 0" }}>
        <button
          disabled={isDisabled}
          onClick={flipSwapDirection}
          style={{
            background: "rgba(18,26,37,0.95)",
            border: `1px solid ${C.border}`,
            borderRadius: "50%",
            width: 32, height: 32,
            color: isDisabled ? C.muted : C.text,
            fontSize: 15,
            cursor: isDisabled ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
          }}
        >↓</button>
      </div>

      {/* ── TO card ── */}
      <div style={swapCard}>
        <div style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: C.dim, letterSpacing: "0.04em" }}>to</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Token out selector */}
          {toTokenMeta ? (
            <button
              onClick={() => setShowTokenSearch((v) => !v)}
              disabled={isDisabled}
              style={tokenPill(toTokenMeta.symbol)}
            >
              <TokenAvatar
                symbol={toTokenMeta.symbol}
                logoUri={resolvedToken?.logoUri}
              />
              <span>{toTokenMeta.symbol}</span>
              <span style={{ color: C.dim, fontSize: 10 }}>›</span>
            </button>
          ) : (
            <button
              onClick={() => setShowTokenSearch(true)}
              disabled={isDisabled}
              style={tokenPill("", true)}
            >
              <span>Select Token</span>
              <span style={{ fontSize: 10 }}>›</span>
            </button>
          )}

          {/* Estimated output */}
          <div style={{
            flex: 1,
            textAlign: "right",
            color: C.dim,
            fontSize: 26,
            fontWeight: 600,
            ...mono,
          }}>
            {quote ? quote.amountOut.toString() : "0"}
          </div>
        </div>

        {/* Balance */}
        <div style={{ fontSize: 10, color: C.dim, marginTop: 10, display: "flex", alignItems: "center", gap: 4 }}>
          <span>🪙</span>
          <span>0</span>
        </div>
      </div>

      {/* ── Token search panel (toggled by "Select Token" / selected token click) ── */}
      {showTokenSearch && (
        <div style={{ ...insetCard(), padding: "10px 12px" }}>
          <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.1em", marginBottom: 8 }}>SELECT TOKEN</div>

          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <input
              value={tokenSearch}
              onChange={(e) => {
                setTokenSearch(e.target.value);
                if (resolvedToken) { setResolvedToken(null); setTokenAddressCopied(false); }
                setTokenResolveError(null);
                resetQuoteState();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); if (!isDisabled && !tokenResolveBusy) runTokenSearch().catch(() => {}); }
              }}
              placeholder="Name, symbol, or paste address"
              disabled={isDisabled}
              style={{
                flex: 1, background: "rgba(8,13,20,0.7)", border: `1px solid ${C.border}`,
                borderRadius: 8, padding: "8px 10px", color: C.text, fontSize: 10,
                outline: "none", ...mono,
              }}
            />
            <button onClick={pasteAndResolveTokenAddress} disabled={isDisabled || tokenClipboardBusy || tokenResolveBusy}
              style={{ ...outlineButton(C.dim), padding: "0 9px", fontSize: 8 }}>
              {tokenClipboardBusy ? "…" : "PASTE"}
            </button>
            <button onClick={() => runTokenSearch()} disabled={isDisabled || tokenResolveBusy}
              style={{ ...outlineButton(C.accent), padding: "0 9px", fontSize: 8 }}>
              {tokenResolveBusy ? "…" : "GO"}
            </button>
          </div>

          {/* KRC20 / KRC721 toggle */}
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            {(["krc20", "krc721"] as KaspaTokenStandard[]).map((standard) => {
              const active = tokenStandard === standard;
              return (
                <button
                  key={standard}
                  onClick={() => setTokenStandard(standard)}
                  disabled={isDisabled}
                  style={{
                    ...outlineButton(active ? C.accent : C.dim),
                    flex: 1, padding: "5px 0", fontSize: 8,
                    background: active ? `${C.accent}20` : "rgba(16,25,35,0.45)",
                    borderColor: active ? `${C.accent}55` : C.border,
                    color: active ? C.accent : C.dim,
                  }}
                >{standard.toUpperCase()}</button>
              );
            })}
          </div>

          {/* Search results */}
          {tokenSearchResults.length > 0 && tokenSearchResults.map((t) => (
            <button
              key={t.id}
              onClick={() => { selectListedTokenOut(t.id); setShowTokenSearch(false); }}
              disabled={!t.enabled}
              style={{
                width: "100%", textAlign: "left", background: "none", border: "none",
                color: t.enabled ? C.text : C.dim, padding: "7px 2px", fontSize: 9,
                cursor: t.enabled ? "pointer" : "not-allowed",
                display: "flex", alignItems: "center", gap: 8,
                borderBottom: `1px solid ${C.border}`, ...mono,
              }}
            >
              <TokenAvatar symbol={t.symbol} size={20} />
              <span style={{ flex: 1 }}>{t.symbol} <span style={{ color: C.dim, fontSize: 8 }}>· {t.name}</span></span>
              <span style={{ color: t.enabled ? C.ok : C.warn, fontSize: 7 }}>
                {t.enabled ? "●" : "SOON"}
              </span>
            </button>
          ))}

          {tokenResolveError && (
            <div style={{ fontSize: 8, color: C.danger, marginTop: 6 }}>{tokenResolveError}</div>
          )}

          {resolvedToken && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <img src={resolvedToken.logoUri} alt={resolvedToken.symbol}
                  style={{ width: 24, height: 24, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 9, color: C.text, fontWeight: 700 }}>{resolvedToken.symbol} · {resolvedToken.standard.toUpperCase()}</div>
                  <div style={{ fontSize: 8, color: C.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{resolvedToken.address}</div>
                </div>
              </div>
              <button onClick={copyResolvedTokenAddress} style={{ ...outlineButton(tokenAddressCopied ? C.ok : C.dim), padding: "4px 7px", fontSize: 8 }}>
                {tokenAddressCopied ? "COPIED" : "COPY"}
              </button>
              <button onClick={clearResolvedToken} style={{ ...outlineButton(C.dim), padding: "4px 7px", fontSize: 8 }}>CLEAR</button>
            </div>
          )}
        </div>
      )}

      {/* ── Slippage ── */}
      <div style={{ ...sectionCard("default", true) }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={sectionKicker}>SLIPPAGE</div>
          <div style={{ fontSize: 9, color: isDisabled ? C.muted : C.text, fontWeight: 700 }}>
            {(slippageBps / 100).toFixed(1)}%
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[25, 50, 100].map((bps) => {
            const active = slippageBps === bps && !isDisabled;
            return (
              <button
                key={bps}
                onClick={() => setSlippageBps(bps)}
                disabled={isDisabled}
                style={{
                  ...outlineButton(active ? C.accent : C.dim),
                  flex: 1, padding: "5px 0", borderRadius: 6,
                  background: active ? `${C.accent}20` : "rgba(33,48,67,0.4)",
                  border: `1px solid ${active ? C.accent : C.border}`,
                  color: active ? C.accent : C.dim,
                  fontSize: 8, fontWeight: 700, cursor: isDisabled ? "not-allowed" : "pointer",
                }}
              >{(bps / 100).toFixed(1)}%</button>
            );
          })}
        </div>
      </div>

      {/* ── Quote / action ── */}
      {!isDisabled ? (
        <>
          <button
            onClick={requestQuote}
            style={{ ...primaryButton(true), width: "100%", padding: "13px 0", fontSize: 11, letterSpacing: "0.1em" }}
            disabled={quoteBusy}
          >
            {quoteBusy ? "REQUESTING QUOTE…" : "GET QUOTE →"}
          </button>

          {quote && (
            <div style={sectionCard("default", true)}>
              <div style={{ ...sectionKicker, marginBottom: 6 }}>QUOTE PREVIEW</div>
              {quote.customTokenOut && (
                <div style={{ fontSize: 8, color: C.text, marginBottom: 6 }}>
                  Output: {quote.customTokenOut.symbol} ({quote.customTokenOut.standard.toUpperCase()})
                </div>
              )}
              <div style={{ fontSize: 8, color: C.text, marginBottom: 4 }}>Route: {quote.route.join(" → ")} · Valid ~30s</div>
              <div style={{ fontSize: 8, color: C.text, marginBottom: 8 }}>Min output: {quote.amountOut.toString()} units</div>
              {!showExecuteConsent ? (
                <button onClick={() => setShowExecuteConsent(true)} style={{ ...primaryButton(true), width: "100%", padding: "8px 0" }} disabled={executeBusy}>
                  SIGN & EXECUTE SWAP
                </button>
              ) : (
                <div style={{ ...insetCard(), padding: "8px 10px" }}>
                  <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.5, marginBottom: 6 }}>
                    Confirm in the external EVM signer. Settlement persisted across restarts.
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={executeQuote} style={{ ...primaryButton(true), flex: 1, padding: "7px 0" }} disabled={executeBusy}>
                      {executeBusy ? "EXECUTING…" : "CONFIRM"}
                    </button>
                    <button onClick={() => setShowExecuteConsent(false)} style={{ ...outlineButton(C.dim), flex: 1, padding: "7px 0" }} disabled={executeBusy}>
                      CANCEL
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div style={{ textAlign: "center", padding: "4px 0" }}>
          <div style={{ fontSize: 8, color: C.muted, letterSpacing: "0.1em" }}>SWAP COMING SOON</div>
        </div>
      )}

      {error && (
        <div style={{ ...insetCard(), border: `1px solid ${C.danger}60`, color: C.danger, fontSize: 8 }}>
          {error}
        </div>
      )}

      {settlements.length > 0 && (
        <div style={{ ...insetCard(), padding: "9px 12px" }}>
          <div style={{ ...sectionKicker, marginBottom: 6 }}>SETTLEMENTS</div>
          {settlements.map((s, i) => (
            <div key={s.id} style={{ marginBottom: i < settlements.length - 1 ? 4 : 0, fontSize: 8, color: C.dim }}>
              <span style={{ color: C.text }}>{s.state}</span>
              {" · "}
              {s.txHash ? `${s.txHash.slice(0, 10)}…` : "tx pending"}
              {" · "}
              {new Date(s.updatedAt).toLocaleTimeString()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
