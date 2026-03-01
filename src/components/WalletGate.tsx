import { useState } from "react";
import { DEFAULT_NETWORK, DEMO_ADDRESS, NETWORK_LABEL } from "../constants";
import { C, mono } from "../tokens";
import { Badge } from "./ui";
import { ForgeAtmosphere } from "./chrome/ForgeAtmosphere";
import { WalletCreator } from "./WalletCreator";
import { WebWalletSetup } from "./WebWalletSetup";

// Protocol capability blocks
const PROTOCOL_STACK = [
  {
    status: "LIVE",
    statusColor: "#39DDB6",
    title: "KAS Accumulation",
    desc: "AI agents accumulate KAS now — Kelly-sized entries, regime-aware execution on the BlockDAG.",
    icon: "◆",
    iconColor: "#39DDB6",
  },
  {
    status: "LIVE",
    statusColor: "#39DDB6",
    title: "DAG-Speed Settlement",
    desc: "Transactions confirm at Kaspa BlockDAG speed — parallel block lattice, sub-second finality.",
    icon: "⚡",
    iconColor: "#39DDB6",
  },
  {
    status: "LIVE",
    statusColor: "#39DDB6",
    title: "Stable PnL Tracking",
    desc: "All agent P&L tracked in USD equivalent. KAS/USDC rate computed on every cycle.",
    icon: "$",
    iconColor: "#39DDB6",
  },
  {
    status: "READY",
    statusColor: "#8F7BFF",
    title: "KAS / USDC Profit Trading",
    desc: "When Kaspa stablecoins launch, agents flip from accumulation to active buy/sell — profiting on KAS price swings.",
    icon: "⇄",
    iconColor: "#8F7BFF",
  },
  {
    status: "READY",
    statusColor: "#F7B267",
    title: "KRC-20 Token Support",
    desc: "Engine ready for KRC-20 tokens on Kaspa. Buy the dip, sell the strength — across any KRC-20/KAS pair.",
    icon: "⬡",
    iconColor: "#F7B267",
  },
  {
    status: "READY",
    statusColor: "#F7B267",
    title: "Kaspa 0x Swaps",
    desc: "Built for Kaspa's 0x-style DEX layer. Agents route capital across pools — KAS, kUSD, kBTC and beyond.",
    icon: "⊕",
    iconColor: "#F7B267",
  },
];

export function WalletGate({ onConnect, onSignInClick }: { onConnect: (session: any) => void; onSignInClick?: () => void }) {
  const [showCreator, setShowCreator] = useState(false);

  const enterDemoMode = () => {
    onConnect({
      address: DEMO_ADDRESS,
      network: DEFAULT_NETWORK,
      provider: "demo",
    });
  };

  return (
    <div className="forge-shell forge-wallet-gate-root" style={{ display: "flex", flexDirection: "column", alignItems: "center", minHeight: "100vh", padding: "clamp(8px, 2vw, 12px)", backgroundColor: C.bg }}>
      <ForgeAtmosphere />

      {/* Top brand row (no tab/chrome background) */}
      <div className="forge-wallet-gate-top-row" style={{ width: "100%", maxWidth: 1600, display: "flex", alignItems: "center", padding: "4px clamp(16px, 3vw, 36px) 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <img
            src="/forge-os-icon3.png"
            alt="Forge-OS"
            style={{
              width: 44,
              height: 44,
              objectFit: "contain",
              filter: "drop-shadow(0 0 8px rgba(57,221,182,0.5))",
            }}
          />
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", ...mono }}>
            <span style={{ color: C.accent }}>FORGE</span>
            <span style={{ color: C.text }}>-OS</span>
          </span>
        </div>
      </div>

      {/* ── FULL-WIDTH CENTERED HERO ── */}
      <div data-testid="wallet-gate-hero" className="forge-wallet-gate-hero" style={{ width: "100%", maxWidth: 1100, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "clamp(28px,5vw,56px) clamp(16px,3vw,32px) clamp(20px,3vw,36px)" }}>
        <div aria-hidden style={{ height: 12 }} />
        <h1 className="forge-wallet-gate-hero-title" style={{ font: `700 clamp(32px,5.5vw,64px)/1.1 'IBM Plex Mono',monospace`, letterSpacing: "0.03em", margin: 0, color: C.text, textWrap: "balance" as any }}>
          <span style={{ color: C.accent, textShadow: "0 0 30px rgba(57,221,182,0.55)" }}>KAS / USDC</span>
          <span style={{ color: C.text, fontWeight: 800 }}> AI TRADING</span>
          <br />
          <span style={{ color: C.dim, fontWeight: 500, fontSize: "0.65em", letterSpacing: "0.06em" }}>⚡ BLOCKDAG SPEED</span>
        </h1>
        <p className="forge-wallet-gate-hero-copy" style={{ font: `500 15px/1.6 'Space Grotesk','Segoe UI',sans-serif`, color: "#9db0c6", maxWidth: "64ch", margin: 0 }}>
          Full-stack DeFi for Kaspa. Agents accumulate KAS today — and flip to active profit trading the moment stablecoins, KRC-20, and Kaspa 0x swaps go live.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          <Badge text={`${NETWORK_LABEL}`} color={C.ok} dot />
          <Badge text="KRC-20 READY" color={C.purple} dot />
          <Badge text="NON-CUSTODIAL" color={C.warn} dot />
          <Badge text="DAG-SPEED EXECUTION" color={C.accent} dot />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 10, marginTop: 4 }}>
          <button
            data-testid="wallet-gate-connect-wallet"
            onClick={onSignInClick}
            style={{
              background: `linear-gradient(90deg, ${C.accent}, #7BE9CF)`,
              border: "none",
              borderRadius: 10,
              cursor: "pointer",
              color: "#04110E",
              fontSize: 13,
              ...mono,
              fontWeight: 700,
              letterSpacing: "0.08em",
              padding: "12px 22px",
              minWidth: 220,
              boxShadow: "0 4px 20px rgba(57,221,182,0.28)",
              transition: "box-shadow 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 6px 28px rgba(57,221,182,0.44)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 20px rgba(57,221,182,0.28)";
            }}
          >
            CONNECT WALLET →
          </button>
          <button
            data-testid="wallet-gate-open-wallet-creator"
            onClick={() => setShowCreator(true)}
            style={{
              background: "linear-gradient(135deg, rgba(57,221,182,0.06) 0%, rgba(8,13,20,0.55) 100%)",
              border: `1px solid ${C.accent}35`,
              borderRadius: 10,
              cursor: "pointer",
              color: C.text,
              fontSize: 11,
              ...mono,
              fontWeight: 700,
              letterSpacing: "0.08em",
              padding: "12px 18px",
              minWidth: 220,
            }}
          >
            NEW? CREATE A WALLET
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", marginTop: 2 }}>
          {[
            { href: "https://x.com/ForgeOSxyz", icon: "𝕏", label: "@ForgeOSxyz", c: C.text },
            { href: "https://github.com/Forge-OS", icon: "⌘", label: "GitHub", c: C.dim },
            { href: "https://t.me/ForgeOSDefi", icon: "✈", label: "Telegram", c: C.dim },
          ].map(item => (
            <a key={item.label} href={item.href} target="_blank" rel="noopener noreferrer"
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "6px 10px", borderRadius: 6,
                background: "rgba(16,25,35,0.5)", border: `1px solid rgba(33,48,67,0.7)`,
                color: item.c, textDecoration: "none", fontSize: 10, fontWeight: 600, ...mono,
              }}>
              <span style={{ fontSize: 12 }}>{item.icon}</span>
              <span>{item.label}</span>
            </a>
          ))}
        </div>
      </div>

      {/* ── MAIN CONTENT GRID ── */}
      <div data-testid="wallet-gate-content" className="forge-content forge-gate-responsive" style={{ width: "100%", maxWidth: 1600, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(360px,520px)", gap: "clamp(20px, 3vw, 40px)", alignItems: "flex-start", padding: "0 clamp(12px,2vw,24px)" }}>

        {/* ── INFO COLUMN ── */}
        <section style={{ display: "flex", flexDirection: "column", gap: 6, justifySelf: "center", width: "100%", maxWidth: 910, textAlign: "center" }}>

          {/* Protocol stack grid */}
          <div style={{ width: "100%" }}>
            <div style={{ fontSize: 10, color: C.dim, ...mono, letterSpacing: "0.16em", marginBottom: 8, textAlign: "center" }}>PROTOCOL CAPABILITIES</div>
            <div className="forge-wallet-gate-protocol-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
              {PROTOCOL_STACK.map((item) => (
                <div key={item.title}
                  style={{
                    background: `linear-gradient(145deg, ${item.iconColor}10 0%, rgba(8,13,20,0.55) 100%)`,
                    border: `1px solid ${item.iconColor}22`,
                    borderRadius: 8, padding: "12px 14px",
                  }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                    <span style={{ fontSize: 18, color: item.iconColor, lineHeight: 1 }}>{item.icon}</span>
                    <span style={{
                      fontSize: 8, color: item.statusColor, fontWeight: 700, ...mono,
                      background: `${item.statusColor}15`, padding: "2px 6px", borderRadius: 3,
                      border: `1px solid ${item.statusColor}30`,
                    }}>{item.status}</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.text, fontWeight: 700, ...mono, marginBottom: 4 }}>{item.title}</div>
                  <div style={{ fontSize: 9, color: C.dim, lineHeight: 1.4 }}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Architecture strip */}
          <div className="forge-wallet-gate-arch-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, width: "100%" }}>
            {[
              ["EXECUTION", "Wallet-native signing + queue lifecycle management"],
              ["TRUTH", "Receipt-aware P&L attribution + consistency checks"],
              ["ROUTING", "DAG-aware capital allocation + Kelly-fraction sizing"],
            ].map(([k, v]) => (
              <div key={k} style={{ border: `1px solid rgba(33,48,67,0.72)`, borderRadius: 10, background: "linear-gradient(180deg, rgba(11,20,30,0.78) 0%, rgba(9,15,23,0.7) 100%)", padding: "12px 14px" }}>
                <div style={{ font: `700 11px/1.2 'IBM Plex Mono',monospace`, color: C.accent, letterSpacing: "0.1em", marginBottom: 4 }}>{k}</div>
                <div style={{ font: `500 9px/1.4 'IBM Plex Mono',monospace`, color: C.dim }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Key numbers */}
          <div className="forge-wallet-gate-key-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, width: "100%" }}>
            {[
              { v: "BlockDAG", l: "Settlement speed" },
              { v: "Non-Custodial", l: "Keys stay in wallet" },
              { v: "KAS/USDC", l: "Pair architecture" },
            ].map(item => (
              <div key={item.v} style={{ border: `1px solid rgba(33,48,67,0.82)`, borderRadius: 10, background: "rgba(10,17,24,0.72)", padding: "12px" }}>
                <div style={{ font: `700 18px/1.2 'IBM Plex Mono',monospace`, color: C.accent, marginBottom: 4 }}>{item.v}</div>
                <div style={{ font: `500 10px/1.3 'IBM Plex Mono',monospace`, letterSpacing: "0.08em", color: C.dim }}>{item.l}</div>
              </div>
            ))}
          </div>

        </section>

        {/* ── CONNECT COLUMN ── */}
        <div className="forge-connect-column" style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: "clamp(-35px,-3vw,-18px)" }}>
          <div aria-hidden style={{ height: "clamp(34px, 5vw, 52px)" }} />
          <WebWalletSetup
            networkLabel={NETWORK_LABEL}
            onEnterDemoMode={enterDemoMode}
          />
        </div>
      </div>

      {/* Responsive override */}
      <style>{`
        @media (max-width: 1200px) {
          .forge-gate-responsive { grid-template-columns: 1fr !important; max-width: 800px; }
          .forge-connect-column { margin-top: 10px !important; }
        }

        @media (max-width: 900px) {
          .forge-wallet-gate-root {
            padding: 8px 6px 18px !important;
          }

          .forge-wallet-gate-top-row {
            justify-content: center !important;
            padding: 2px 8px 0 !important;
          }

          .forge-wallet-gate-hero {
            max-width: 100% !important;
            padding: 20px 10px 14px !important;
            gap: 10px !important;
          }

          .forge-wallet-gate-hero-title {
            font-size: clamp(26px, 9vw, 38px) !important;
            line-height: 1.15 !important;
          }

          .forge-wallet-gate-hero-copy {
            font-size: 13px !important;
            max-width: 100% !important;
          }

          .forge-gate-responsive {
            padding: 0 8px !important;
            gap: 12px !important;
          }

          .forge-connect-column {
            margin-top: 0 !important;
          }

          .forge-wallet-gate-protocol-grid,
          .forge-wallet-gate-arch-grid,
          .forge-wallet-gate-key-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
        }

        @media (max-width: 640px) {
          .forge-wallet-gate-protocol-grid,
          .forge-wallet-gate-arch-grid,
          .forge-wallet-gate-key-grid {
            grid-template-columns: 1fr !important;
          }
        }

        @media (max-width: 430px) {
          .forge-wallet-gate-root {
            padding: 6px 4px 14px !important;
          }

          .forge-wallet-gate-hero {
            padding: 16px 8px 12px !important;
          }

          .forge-wallet-gate-hero-title {
            font-size: clamp(23px, 8.8vw, 30px) !important;
          }

          .forge-wallet-gate-hero-copy {
            font-size: 12px !important;
            line-height: 1.5 !important;
          }

          .forge-wallet-gate-protocol-grid > div,
          .forge-wallet-gate-arch-grid > div,
          .forge-wallet-gate-key-grid > div {
            padding: 10px !important;
          }
        }
      `}</style>

      {showCreator && (
        <WalletCreator
          onConnect={(session) => { setShowCreator(false); onConnect(session); }}
          onClose={() => setShowCreator(false)}
        />
      )}
    </div>
  );
}
