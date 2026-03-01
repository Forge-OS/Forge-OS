import { describe, expect, it, vi } from "vitest";
import { createAgentExecutionDispatcher } from "../../extension/tx/agentDispatcher";

describe("agent dispatcher", () => {
  it("routes agent intent through deterministic kernel with agent telemetry context", async () => {
    const executeIntent = vi.fn(async () => ({ id: "tx1", state: "CONFIRMING", txId: "abc" }));
    const dispatch = createAgentExecutionDispatcher(executeIntent as any);

    await dispatch({
      agentId: "agent_42",
      fromAddress: "kaspa:qsender",
      network: "mainnet",
      recipients: [{ address: "kaspa:qreceiver", amountKas: 0.02 }],
      agentJobId: "job_abc",
      context: { strategy: "dca" },
    });

    expect(executeIntent).toHaveBeenCalledTimes(1);
    const [, options] = executeIntent.mock.calls[0];
    expect(options.telemetry.channel).toBe("agent");
    expect(options.telemetry.context).toEqual(
      expect.objectContaining({
        agentId: "agent_42",
        agentJobId: "job_abc",
        strategy: "dca",
      }),
    );
  });
});

