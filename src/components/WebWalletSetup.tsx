import { Badge, Card, Divider } from "./ui";
import { C, mono } from "../tokens";

type WebWalletSetupProps = {
  networkLabel: string;
  onEnterDemoMode: () => void;
};

export function WebWalletSetup({
  networkLabel,
  onEnterDemoMode,
}: WebWalletSetupProps) {
  return (
    <div data-testid="web-wallet-setup" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Card p={20} style={{ border: `1px solid rgba(57,221,182,0.14)` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 16, color: C.text, fontWeight: 700, ...mono }}>Connect Wallet</div>
          <Badge text={networkLabel} color={C.ok} dot />
        </div>
        <div style={{ fontSize: 12, color: C.dim, marginBottom: 16 }}>
          All operations are wallet-native. Forge-OS never stores private keys or signs on your behalf.
        </div>

        <div style={{ marginBottom: 10 }}>
          <button
            data-testid="wallet-gate-enter-demo-mode"
            onClick={onEnterDemoMode}
            style={{
              width: "100%",
              background: "rgba(11,17,24,0.85)",
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              cursor: "pointer",
              color: C.text,
              fontSize: 10,
              ...mono,
              fontWeight: 700,
              letterSpacing: "0.08em",
              padding: "10px 0",
            }}
          >
            ENTER DEMO MODE
          </button>
        </div>

        <Divider m={14} />
        <div style={{ fontSize: 10, color: C.dim, ...mono, lineHeight: 1.5 }}>
          Forge-OS never requests your private key · All signing happens inside your wallet · {networkLabel}
        </div>
      </Card>

      <div
        style={{
          background: `linear-gradient(135deg, ${C.purple}10 0%, rgba(8,13,20,0.5) 100%)`,
          border: `1px solid ${C.purple}28`,
          borderRadius: 10,
          padding: "14px 18px",
        }}
      >
        <div style={{ fontSize: 10, color: C.purple, fontWeight: 700, ...mono, letterSpacing: "0.12em", marginBottom: 6 }}>
          KASPA STABLECOIN UPGRADE · READY
        </div>
        <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.5 }}>
          Agents accumulate KAS now. When Kaspa stablecoins launch at L1, agents automatically switch to active buy/sell
          — buying dips, selling strength, and booking profit in USD. KRC-20 tokens and Kaspa 0x swaps are already in the
          engine. No migration, no downtime.
        </div>
      </div>
    </div>
  );
}
