import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "redis";
import { getFreePort, httpJson, spawnNodeProcess, startJsonServer, stopProcess, waitFor, waitForHttp } from "./helpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const TEST_REDIS_URL = String(process.env.TEST_REDIS_URL || process.env.SCHEDULER_REDIS_URL || "").trim();
const describeIfRedis = TEST_REDIS_URL ? describe : describe.skip;

function leaderHealth(body: any) {
  return {
    instanceId: String(body?.scheduler?.leader?.instanceId || ""),
    active: Boolean(body?.scheduler?.leader?.active),
    fenceToken: Math.max(0, Number(body?.scheduler?.leader?.fenceToken || 0)),
  };
}

function cycleEventForAgent(events: any[], agentKey: string) {
  return (Array.isArray(events) ? events : [])
    .filter((e: any) => e?.type === "scheduler_cycle" && String(e?.agentKey || "") === agentKey);
}

describeIfRedis("scheduler + callback consumer integration (multi-instance duplicate-dispatch + fence enforcement)", () => {
  const children: Array<ReturnType<typeof spawnNodeProcess>> = [];
  const servers: Array<{ close: (cb?: () => void) => void }> = [];
  const redisClients: any[] = [];

  afterEach(async () => {
    await Promise.all(children.map((c) => stopProcess(c.child)));
    children.length = 0;
    await Promise.all(
      servers.map(
        (s) =>
          new Promise<void>((resolve) => {
            try { s.close(() => resolve()); } catch { resolve(); }
          })
      )
    );
    servers.length = 0;
    await Promise.all(
      redisClients.map(async (c) => {
        try {
          await c.quit();
        } catch {
          try { await c.disconnect(); } catch {}
        }
      })
    );
    redisClients.length = 0;
  });

  it("prevents double-accept callback dispatch across two schedulers and rejects stale fence after failover", async () => {
    const kasPort = await getFreePort();
    const callbackPort = await getFreePort();
    const schedulerPortA = await getFreePort();
    const schedulerPortB = await getFreePort();

    const kasServer = await startJsonServer(kasPort, async (req, _body, url) => {
      if (req.method === "GET" && url.pathname === "/info/price") return { body: { price: 0.12 } };
      if (req.method === "GET" && url.pathname === "/info/blockdag") {
        return { body: { networkName: "kaspa-mainnet", headerCount: 123, blockCount: 123, daaScore: 123 } };
      }
      if (req.method === "GET" && /\/addresses\/.+\/balance$/.test(url.pathname)) return { body: { balance: 100000000 } };
      return { status: 404, body: { error: "not_found" } };
    });
    servers.push(kasServer as any);

    const schedulerPrefix = `forgeos:scheduler:cbtest:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const callbackPrefix = `forgeos:callback:cbtest:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const agentKey = "user-multi:agent-multi";

    const callbackConsumer = spawnNodeProcess(["server/callback-consumer/index.mjs"], {
      cwd: repoRoot,
      env: {
        PORT: String(callbackPort),
        HOST: "127.0.0.1",
        CALLBACK_CONSUMER_REDIS_URL: TEST_REDIS_URL,
        CALLBACK_CONSUMER_REDIS_PREFIX: callbackPrefix,
        CALLBACK_CONSUMER_AUTH_READS: "false",
      },
    });
    children.push(callbackConsumer);
    await waitForHttp(`http://127.0.0.1:${callbackPort}/health`);

    const schedulerBaseEnv = {
      HOST: "127.0.0.1",
      KAS_API_BASE: `http://127.0.0.1:${kasPort}`,
      SCHEDULER_TICK_MS: "60000",
      SCHEDULER_REDIS_URL: TEST_REDIS_URL,
      SCHEDULER_REDIS_PREFIX: schedulerPrefix,
      SCHEDULER_REDIS_AUTHORITATIVE_QUEUE: "true",
      SCHEDULER_REDIS_RESET_EXEC_QUEUE_ON_BOOT: "false",
      SCHEDULER_AUTH_READS: "false",
      SCHEDULER_CALLBACK_TIMEOUT_MS: "1000",
      SCHEDULER_LEADER_LOCK_TTL_MS: "1000",
      SCHEDULER_LEADER_LOCK_RENEW_MS: "500",
      SCHEDULER_LEADER_LOCK_RENEW_JITTER_MS: "0",
      SCHEDULER_LEADER_ACQUIRE_BACKOFF_MIN_MS: "50",
      SCHEDULER_LEADER_ACQUIRE_BACKOFF_MAX_MS: "100",
    };

    const schedulerA = spawnNodeProcess(["server/scheduler/index.mjs"], {
      cwd: repoRoot,
      env: { ...schedulerBaseEnv, PORT: String(schedulerPortA), SCHEDULER_INSTANCE_ID: "sched-a" },
    });
    const schedulerB = spawnNodeProcess(["server/scheduler/index.mjs"], {
      cwd: repoRoot,
      env: { ...schedulerBaseEnv, PORT: String(schedulerPortB), SCHEDULER_INSTANCE_ID: "sched-b" },
    });
    children.push(schedulerA, schedulerB);

    const healthA = `http://127.0.0.1:${schedulerPortA}/health`;
    const healthB = `http://127.0.0.1:${schedulerPortB}/health`;
    await Promise.all([waitForHttp(healthA), waitForHttp(healthB)]);

    const redis = createClient({ url: TEST_REDIS_URL });
    redisClients.push(redis);
    await redis.connect();

    const register = await httpJson(`http://127.0.0.1:${schedulerPortA}/v1/agents/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "user-multi",
        id: "agent-multi",
        walletAddress: "kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85",
        callbackUrl: `http://127.0.0.1:${callbackPort}/v1/scheduler/cycle`,
        cycleIntervalMs: 1000,
      }),
    });
    expect(register.res.status).toBe(200);

    let firstLeader: { key: "a" | "b"; port: number; instanceId: string; fenceToken: number } | null = null;
    await waitFor(async () => {
      const [ha, hb] = await Promise.all([httpJson(healthA), httpJson(healthB)]);
      const a = leaderHealth(ha.body);
      const b = leaderHealth(hb.body);
      const leaders = [
        ...(a.active ? [{ key: "a" as const, port: schedulerPortA, ...a }] : []),
        ...(b.active ? [{ key: "b" as const, port: schedulerPortB, ...b }] : []),
      ];
      if (leaders.length !== 1) return false;
      if (leaders[0].fenceToken < 1) return false;
      firstLeader = leaders[0];
      return true;
    }, 12_000, 100);
    expect(firstLeader).toBeTruthy();

    await new Promise((r) => setTimeout(r, 1100));
    await Promise.all([
      httpJson(`http://127.0.0.1:${schedulerPortA}/v1/scheduler/tick`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
      httpJson(`http://127.0.0.1:${schedulerPortB}/v1/scheduler/tick`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
    ]);

    let firstEvent: any = null;
    await waitFor(async () => {
      const eventsRes = await httpJson(`http://127.0.0.1:${callbackPort}/v1/events`);
      const events = cycleEventForAgent(eventsRes.body?.events, agentKey);
      if (events.length !== 1) return false;
      firstEvent = events[0];
      return Number(firstEvent?.fenceToken || 0) >= 1;
    }, 12_000, 100);

    expect(firstEvent).toBeTruthy();
    expect(String(firstEvent.agentKey)).toBe(agentKey);
    expect(["sched-a", "sched-b"]).toContain(String(firstEvent.schedulerInstanceId || ""));

    const cbMetricsAfterFirst = await fetch(`http://127.0.0.1:${callbackPort}/metrics`).then((r) => r.text());
    expect(cbMetricsAfterFirst).toMatch(/forgeos_callback_consumer_cycle_accepted_total\s+1/);
    expect(cbMetricsAfterFirst).toMatch(/forgeos_callback_consumer_cycle_duplicate_total\s+0/);

    const oldLeaderChild = firstLeader!.key === "a" ? schedulerA.child : schedulerB.child;
    const followerPort = firstLeader!.key === "a" ? schedulerPortB : schedulerPortA;
    await stopProcess(oldLeaderChild);

    let failoverFence = 0;
    await waitFor(async () => {
      const h = await httpJson(`http://127.0.0.1:${followerPort}/health`);
      const leader = leaderHealth(h.body);
      if (!leader.active) return false;
      if (leader.fenceToken <= Number(firstEvent?.fenceToken || 0)) return false;
      failoverFence = leader.fenceToken;
      return true;
    }, 15_000, 100);

    await new Promise((r) => setTimeout(r, 1100));
    const tickAfterFailover = await httpJson(`http://127.0.0.1:${followerPort}/v1/scheduler/tick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(tickAfterFailover.res.status).toBe(200);

    let newestEvent: any = null;
    await waitFor(async () => {
      const eventsRes = await httpJson(`http://127.0.0.1:${callbackPort}/v1/events`);
      const events = cycleEventForAgent(eventsRes.body?.events, agentKey);
      if (events.length < 2) return false;
      newestEvent = events[0];
      return Number(newestEvent?.fenceToken || 0) > Number(firstEvent?.fenceToken || 0);
    }, 12_000, 100);

    expect(Number(newestEvent?.fenceToken || 0)).toBeGreaterThan(Number(firstEvent?.fenceToken || 0));
    expect(Number(newestEvent?.fenceToken || 0)).toBeGreaterThanOrEqual(failoverFence);
    expect(String(newestEvent?.schedulerInstanceId || "")).not.toBe(String(firstEvent?.schedulerInstanceId || ""));

    const staleFence = Math.max(1, Number(firstEvent?.fenceToken || 1));
    const stalePost = await httpJson(`http://127.0.0.1:${callbackPort}/v1/scheduler/cycle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ForgeOS-Agent-Key": agentKey,
        "X-ForgeOS-Idempotency-Key": `forgeos.scheduler:${agentKey}:${staleFence}:stale-manual-${Date.now()}`,
        "X-ForgeOS-Leader-Fence-Token": String(staleFence),
      },
      body: JSON.stringify({
        event: "forgeos.scheduler.cycle",
        scheduler: {
          instanceId: String(firstEvent?.schedulerInstanceId || "sched-old"),
          leaderFenceToken: staleFence,
          queueTaskId: `stale-task-${Date.now()}`,
          callbackIdempotencyKey: `stale-${Date.now()}`,
        },
        agent: { id: "agent-multi", userId: "user-multi", name: "Agent Multi", strategyLabel: "Custom" },
        market: { priceUsd: 0.12, dag: { daaScore: 123 } },
      }),
    });
    expect(stalePost.res.status).toBe(409);
    expect(stalePost.body?.error?.message).toBe("stale_fence_token");

    const cbMetricsFinal = await fetch(`http://127.0.0.1:${callbackPort}/metrics`).then((r) => r.text());
    expect(cbMetricsFinal).toMatch(/forgeos_callback_consumer_cycle_accepted_total\s+2/);
    expect(cbMetricsFinal).toMatch(/forgeos_callback_consumer_cycle_stale_fence_total\s+1/);

    const schedulerLeaderLock = await redis.get(`${schedulerPrefix}:leader_lock`);
    const schedulerLeaderFence = await redis.get(`${schedulerPrefix}:leader_fence`);
    expect(String(schedulerLeaderLock || "")).toContain(`|${Number(newestEvent?.fenceToken || 0)}|`);
    expect(Number(schedulerLeaderFence || 0)).toBeGreaterThanOrEqual(Number(newestEvent?.fenceToken || 0));
  }, 60_000);
});

