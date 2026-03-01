import { describe, expect, it } from "vitest";
import { parseKaspaStreamEvent } from "../../src/components/dashboard/hooks/useKaspaFeed";

describe("Kaspa stream event parser", () => {
  it("extracts DAA score from websocket payload", () => {
    const evt = parseKaspaStreamEvent(
      JSON.stringify({
        eventType: "virtual-daa-score-changed",
        data: { virtualDaaScore: 123456789 },
      }),
    );
    expect(evt.kind).toBe("daa");
    expect(evt.daaScore).toBe(123456789);
  });

  it("detects wallet-impacting UTXO push events", () => {
    const evt = parseKaspaStreamEvent(
      {
        eventType: "utxos-changed",
        added: [{ address: "kaspa:qpy5x8f7lz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vyr2cz8w" }],
      },
      "kaspa:qpy5x8f7lz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vyr2cz8w",
    );
    expect(evt.kind).toBe("utxo");
    expect(evt.affectsWallet).toBe(true);
  });

  it("returns unknown for unstructured payloads", () => {
    const evt = parseKaspaStreamEvent("heartbeat");
    expect(evt.kind).toBe("unknown");
    expect(evt.affectsWallet).toBe(false);
  });
});

