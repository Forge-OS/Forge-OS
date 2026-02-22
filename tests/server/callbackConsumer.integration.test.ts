import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getFreePort, httpJson, spawnNodeProcess, stopProcess, waitForHttp } from "./helpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

describe("callback consumer reference service", () => {
  const children: Array<ReturnType<typeof spawnNodeProcess>> = [];

  afterEach(async () => {
    await Promise.all(children.map((c) => stopProcess(c.child)));
    children.length = 0;
  });

  it("enforces idempotency and fence ordering for scheduler callbacks and stores receipts", async () => {
    const port = await getFreePort();
    const proc = spawnNodeProcess(["server/callback-consumer/index.mjs"], {
      cwd: repoRoot,
      env: { PORT: String(port), HOST: "127.0.0.1" },
    });
    children.push(proc);
    await waitForHttp(`http://127.0.0.1:${port}/health`);

    const callbackBody = {
      event: "forgeos.scheduler.cycle",
      scheduler: { instanceId: "sched-a", leaderFenceToken: 10, queueTaskId: "task-1", callbackIdempotencyKey: "idem-1" },
      agent: { id: "agent-1", userId: "user-1", name: "Agent 1", strategyLabel: "DCA" },
      market: { priceUsd: 0.12, dag: { daaScore: 123 } },
    };

    const baseHeaders = {
      "Content-Type": "application/json",
      "X-ForgeOS-Agent-Key": "user-1:agent-1",
    };

    const accepted = await httpJson(`http://127.0.0.1:${port}/v1/scheduler/cycle`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "X-ForgeOS-Idempotency-Key": "forgeos.scheduler:user-1:agent-1:10:task-1",
        "X-ForgeOS-Leader-Fence-Token": "10",
      },
      body: JSON.stringify(callbackBody),
    });
    expect(accepted.res.status).toBe(200);
    expect(accepted.body.ok).toBe(true);
    expect(accepted.body.duplicate).toBe(false);

    const duplicate = await httpJson(`http://127.0.0.1:${port}/v1/scheduler/cycle`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "X-ForgeOS-Idempotency-Key": "forgeos.scheduler:user-1:agent-1:10:task-1",
        "X-ForgeOS-Leader-Fence-Token": "10",
      },
      body: JSON.stringify(callbackBody),
    });
    expect(duplicate.res.status).toBe(200);
    expect(duplicate.body.duplicate).toBe(true);

    const stale = await httpJson(`http://127.0.0.1:${port}/v1/scheduler/cycle`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "X-ForgeOS-Idempotency-Key": "forgeos.scheduler:user-1:agent-1:9:task-2",
        "X-ForgeOS-Leader-Fence-Token": "9",
      },
      body: JSON.stringify({
        ...callbackBody,
        scheduler: { ...callbackBody.scheduler, leaderFenceToken: 9, queueTaskId: "task-2", callbackIdempotencyKey: "idem-2" },
      }),
    });
    expect(stale.res.status).toBe(409);
    expect(stale.body.error.message).toBe("stale_fence_token");

    const newerFence = await httpJson(`http://127.0.0.1:${port}/v1/scheduler/cycle`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "X-ForgeOS-Idempotency-Key": "forgeos.scheduler:user-1:agent-1:11:task-3",
        "X-ForgeOS-Leader-Fence-Token": "11",
      },
      body: JSON.stringify({
        ...callbackBody,
        scheduler: { ...callbackBody.scheduler, leaderFenceToken: 11, queueTaskId: "task-3", callbackIdempotencyKey: "idem-3" },
      }),
    });
    expect(newerFence.res.status).toBe(200);
    expect(newerFence.body.accepted).toBe(true);

    const txid = "a".repeat(64);
    const receiptAccepted = await httpJson(`http://127.0.0.1:${port}/v1/execution-receipts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        txid,
        userId: "user-1",
        agentId: "agent-1",
        status: "confirmed",
        confirmations: 3,
        feeKas: 0.0001,
        confirmTsSource: "chain",
      }),
    });
    expect(receiptAccepted.res.status).toBe(200);
    expect(receiptAccepted.body.txid).toBe(txid);

    const receiptDuplicate = await httpJson(`http://127.0.0.1:${port}/v1/execution-receipts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        txid,
        userId: "user-1",
        agentId: "agent-1",
        status: "confirmed",
      }),
    });
    expect(receiptDuplicate.res.status).toBe(200);
    expect(receiptDuplicate.body.duplicate).toBe(true);

    const receiptFetch = await httpJson(`http://127.0.0.1:${port}/v1/execution-receipts?txid=${txid}`);
    expect(receiptFetch.res.status).toBe(200);
    expect(receiptFetch.body.receipt.txid).toBe(txid);

    const metricsRes = await fetch(`http://127.0.0.1:${port}/metrics`);
    const metricsText = await metricsRes.text();
    expect(metricsText).toContain("forgeos_callback_consumer_cycle_accepted_total 2");
    expect(metricsText).toContain("forgeos_callback_consumer_cycle_duplicate_total 1");
    expect(metricsText).toContain("forgeos_callback_consumer_cycle_stale_fence_total 1");
  }, 20_000);
});

