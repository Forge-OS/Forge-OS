import { beforeEach, describe, expect, it, vi } from "vitest";

const MAINNET_SAMPLE_ADDRESS =
  "kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85";
const TESTNET_SAMPLE_ADDRESS =
  "kaspatest:qpqz2vxj23kvh0m73ta2jjn2u4cv4tlufqns2eap8mxyyt0rvrxy6ejkful67";

describe("kaspaNativeAdapter", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("parses a valid kaspa-native quote response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          quoteId: "q_123",
          amountOut: "1000000",
          feeAmount: "1500",
          priceImpactBps: 25,
          route: ["KAS", "USDC"],
          validUntil: Date.now() + 60_000,
          settlementAddress: MAINNET_SAMPLE_ADDRESS,
        }),
      })),
    );

    const { fetchKaspaNativeQuote } = await import("../../extension/swap/kaspaNativeAdapter");
    const quote = await fetchKaspaNativeQuote(
      { tokenIn: "KAS", tokenOut: "USDC", amountIn: 100_000_000n, slippageBps: 50 },
      { endpoint: "https://forge-os.xyz/api/swap", network: "mainnet", walletAddress: MAINNET_SAMPLE_ADDRESS },
    );

    expect(quote.routeSource).toBe("kaspa_native");
    expect(quote.amountOut).toBe(1_000_000n);
    expect(quote.fee).toBe(1_500n);
    expect(quote.route).toEqual(["KAS", "USDC"]);
  });

  it("rejects quote with settlement address on the wrong network prefix", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          quoteId: "q_bad_prefix",
          amountOut: "10",
          feeAmount: "1",
          priceImpactBps: 5,
          route: ["KAS", "USDT"],
          validUntil: Date.now() + 60_000,
          settlementAddress: TESTNET_SAMPLE_ADDRESS,
        }),
      })),
    );

    const { fetchKaspaNativeQuote } = await import("../../extension/swap/kaspaNativeAdapter");
    await expect(
      fetchKaspaNativeQuote(
        { tokenIn: "KAS", tokenOut: "USDT", amountIn: 10_000n, slippageBps: 50 },
        { endpoint: "https://forge-os.xyz/api/swap", network: "mainnet", walletAddress: MAINNET_SAMPLE_ADDRESS },
      ),
    ).rejects.toThrow(/network mismatch/i);
  });

  it("maps status endpoint values into normalized execution states", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          state: "confirmed",
          confirmations: 3,
          txId: "tx_abc",
        }),
      })),
    );

    const { fetchKaspaNativeExecutionStatus } = await import("../../extension/swap/kaspaNativeAdapter");
    const status = await fetchKaspaNativeExecutionStatus({
      endpoint: "https://forge-os.xyz/api/swap",
      network: "testnet-10",
      quoteId: "q1",
      depositTxId: "deposit_1",
    });

    expect(status.state).toBe("confirmed");
    expect(status.confirmations).toBe(3);
    expect(status.settlementTxId).toBe("tx_abc");
  });

  it("extracts quote metadata from rawQuote", async () => {
    const { extractKaspaNativeQuoteMeta } = await import("../../extension/swap/kaspaNativeAdapter");
    const meta = extractKaspaNativeQuoteMeta({
      tokenIn: "KAS",
      tokenOut: "USDC",
      amountIn: 1n,
      amountOut: 1n,
      priceImpact: 0,
      fee: 0n,
      route: ["KAS", "USDC"],
      validUntil: Date.now() + 1000,
      dexEndpoint: "https://forge-os.xyz/api/swap",
      routeSource: "kaspa_native",
      rawQuote: {
        quoteId: "qid1",
        settlementAddress: MAINNET_SAMPLE_ADDRESS,
      },
    });
    expect(meta.quoteId).toBe("qid1");
    expect(meta.settlementAddress).toBe(MAINNET_SAMPLE_ADDRESS);
  });
});
