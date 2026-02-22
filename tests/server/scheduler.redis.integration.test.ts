import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "redis";
import { getFreePort, httpJson, spawnNodeProcess, startJsonServer, stopProcess, waitFor, waitForHttp } from "./helpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const TEST_REDIS_URL = String(process.env.TEST_REDIS_URL || process.env.SCHEDULER_REDIS_URL || "").trim();

const describeIfRedis = TEST_REDIS_URL ? describe : describe.skip;

function taskPayload(taskId: string, queueKey: string) {
  return JSON.stringify({
    id: taskId,
    kind: "agent_cycle",
    queueKey,
    enqueuedAt: Date.now(),
    leaderFenceToken: 0,
    instanceId: "vitest-redis",
  });
}

describeIfRedis("scheduler redis integration (boot recovery + agent removal under lease)", () => {
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
            try {
              s.close(() => resolve());
            } catch {
              resolve();
            }
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

  it("recovers unleased processing tasks on boot and preserves leased tasks during agent removal", async () => {
    const kasPort = await getFreePort();
    const schedulerPort1 = await getFreePort();
    const schedulerPort2 = await getFreePort();

    const kasServer = await startJsonServer(kasPort, async (req, _body, url) => {
      if (req.method === "GET" && url.pathname === "/info/price") return { body: { price: 0.12 } };
      if (req.method === "GET" && url.pathname === "/info/blockdag") {
        return { body: { networkName: "kaspa-mainnet", headerCount: 123, blockCount: 123, daaScore: 123 } };
      }
      if (req.method === "GET" && /\/addresses\/.+\/balance$/.test(url.pathname)) return { body: { balance: 100000000 } };
      return { status: 404, body: { error: "not_found" } };
    });
    servers.push(kasServer as any);

    const prefix = `forgeos:scheduler:test:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const queueKey = "user-redis:agent-redis";
    const taskRecovered = `task-recover-${Math.random().toString(36).slice(2, 8)}`;
    const taskLeased = `task-lease-${Math.random().toString(36).slice(2, 8)}`;
    const taskReady = `task-ready-${Math.random().toString(36).slice(2, 8)}`;

    const scheduler1 = spawnNodeProcess(["server/scheduler/index.mjs"], {
      cwd: repoRoot,
      env: {
        PORT: String(schedulerPort1),
        HOST: "127.0.0.1",
        KAS_API_BASE: `http://127.0.0.1:${kasPort}`,
        SCHEDULER_TICK_MS: "60000",
        SCHEDULER_REDIS_URL: TEST_REDIS_URL,
        SCHEDULER_REDIS_PREFIX: prefix,
        SCHEDULER_REDIS_AUTHORITATIVE_QUEUE: "true",
        SCHEDULER_REDIS_RESET_EXEC_QUEUE_ON_BOOT: "false",
        SCHEDULER_AUTH_READS: "false",
      },
    });
    children.push(scheduler1);
    await waitForHttp(`http://127.0.0.1:${schedulerPort1}/health`);

    const register = await httpJson(`http://127.0.0.1:${schedulerPort1}/v1/agents/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "user-redis",
        id: "agent-redis",
        walletAddress: "kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85",
        callbackUrl: "http://127.0.0.1:9/blackhole",
        cycleIntervalMs: 60_000,
      }),
    });
    expect(register.res.status).toBe(200);

    await stopProcess(scheduler1.child);

    const redis = createClient({ url: TEST_REDIS_URL });
    redisClients.push(redis);
    await redis.connect();

    const keys = {
      queue: `${prefix}:cycle_queue`,
      processing: `${prefix}:cycle_queue_processing`,
      payloads: `${prefix}:cycle_queue_payloads`,
      inflight: `${prefix}:cycle_queue_inflight`,
      owners: `${prefix}:cycle_queue_task_owners`,
      agentTasks: `${prefix}:exec_agent_tasks:${queueKey}`,
      execLeasePrefix: `${prefix}:exec_lease`,
      agents: `${prefix}:agents`,
    };
    const leaseLeasedKey = `${keys.execLeasePrefix}:${taskLeased}`;
    const now = Date.now();

    await redis.multi()
      .hSet(keys.payloads, {
        [taskRecovered]: taskPayload(taskRecovered, queueKey),
        [taskLeased]: taskPayload(taskLeased, queueKey),
        [taskReady]: taskPayload(taskReady, queueKey),
      })
      .rPush(keys.processing, [taskRecovered, taskLeased])
      .zAdd(keys.inflight, [
        { score: now + 30_000, value: taskRecovered },
        { score: now + 30_000, value: taskLeased },
      ])
      .rPush(keys.queue, [taskReady])
      .set(leaseLeasedKey, JSON.stringify({ ts: now, holder: "test" }), { PX: 60_000 })
      .exec();

    const scheduler2 = spawnNodeProcess(["server/scheduler/index.mjs"], {
      cwd: repoRoot,
      env: {
        PORT: String(schedulerPort2),
        HOST: "127.0.0.1",
        KAS_API_BASE: `http://127.0.0.1:${kasPort}`,
        SCHEDULER_TICK_MS: "60000",
        SCHEDULER_REDIS_URL: TEST_REDIS_URL,
        SCHEDULER_REDIS_PREFIX: prefix,
        SCHEDULER_REDIS_AUTHORITATIVE_QUEUE: "true",
        SCHEDULER_REDIS_RESET_EXEC_QUEUE_ON_BOOT: "false",
        SCHEDULER_AUTH_READS: "false",
      },
    });
    children.push(scheduler2);
    await waitForHttp(`http://127.0.0.1:${schedulerPort2}/health`);

    await waitFor(async () => {
      const health = await httpJson(`http://127.0.0.1:${schedulerPort2}/health`);
      return Number(health.body?.redis?.execQueueRecoveredOnBootTotal || 0) >= 1;
    }, 10_000, 150);

    const readyAfterBoot = await redis.lRange(keys.queue, 0, -1);
    const processingAfterBoot = await redis.lRange(keys.processing, 0, -1);
    const inflightAfterBoot = await redis.zRange(keys.inflight, 0, -1);
    const ownersAfterBoot = await redis.hGetAll(keys.owners);
    const agentTaskSetAfterBoot = await redis.sMembers(keys.agentTasks);

    expect(readyAfterBoot).toEqual(expect.arrayContaining([taskReady, taskRecovered]));
    expect(processingAfterBoot).toContain(taskLeased);
    expect(processingAfterBoot).not.toContain(taskRecovered);
    expect(inflightAfterBoot).toContain(taskLeased);
    expect(inflightAfterBoot).not.toContain(taskRecovered);
    expect(String(ownersAfterBoot[taskRecovered])).toBe(queueKey);
    expect(String(ownersAfterBoot[taskLeased])).toBe(queueKey);
    expect(String(ownersAfterBoot[taskReady])).toBe(queueKey);
    expect(agentTaskSetAfterBoot).toEqual(expect.arrayContaining([taskRecovered, taskLeased, taskReady]));

    const remove = await httpJson(`http://127.0.0.1:${schedulerPort2}/v1/agents/agent-redis/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "user-redis", action: "remove" }),
    });
    expect(remove.res.status).toBe(200);

    await waitFor(async () => {
      const payloads = await redis.hGetAll(keys.payloads);
      return !payloads[taskRecovered] && !payloads[taskReady];
    }, 8000, 100);

    const readyAfterRemove = await redis.lRange(keys.queue, 0, -1);
    const processingAfterRemove = await redis.lRange(keys.processing, 0, -1);
    const inflightAfterRemove = await redis.zRange(keys.inflight, 0, -1);
    const payloadsAfterRemove = await redis.hGetAll(keys.payloads);
    const ownersAfterRemove = await redis.hGetAll(keys.owners);
    const agentTaskSetAfterRemove = await redis.sMembers(keys.agentTasks);
    const agentRecord = await redis.hGet(keys.agents, queueKey);

    expect(readyAfterRemove).not.toContain(taskRecovered);
    expect(readyAfterRemove).not.toContain(taskReady);
    expect(payloadsAfterRemove[taskRecovered]).toBeUndefined();
    expect(payloadsAfterRemove[taskReady]).toBeUndefined();
    expect(ownersAfterRemove[taskRecovered]).toBeUndefined();
    expect(ownersAfterRemove[taskReady]).toBeUndefined();

    expect(processingAfterRemove).toContain(taskLeased);
    expect(inflightAfterRemove).toContain(taskLeased);
    expect(payloadsAfterRemove[taskLeased]).toBeTruthy();
    expect(ownersAfterRemove[taskLeased]).toBe(queueKey);
    expect(agentTaskSetAfterRemove).toContain(taskLeased);
    expect(agentTaskSetAfterRemove).not.toContain(taskRecovered);
    expect(agentTaskSetAfterRemove).not.toContain(taskReady);
    expect(agentRecord).toBeNull();
  }, 40_000);
});

