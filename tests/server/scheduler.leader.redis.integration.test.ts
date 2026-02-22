import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "redis";
import { getFreePort, httpJson, spawnNodeProcess, stopProcess, waitFor, waitForHttp } from "./helpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const TEST_REDIS_URL = String(process.env.TEST_REDIS_URL || process.env.SCHEDULER_REDIS_URL || "").trim();

const describeIfRedis = TEST_REDIS_URL ? describe : describe.skip;

type Spawned = ReturnType<typeof spawnNodeProcess>;

function leaderHealthParts(body: any) {
  return {
    instanceId: String(body?.scheduler?.leader?.instanceId || ""),
    active: Boolean(body?.scheduler?.leader?.active),
    fenceToken: Math.max(0, Number(body?.scheduler?.leader?.fenceToken || 0)),
  };
}

describeIfRedis("scheduler redis integration (multi-instance leader fencing/failover)", () => {
  const children: Spawned[] = [];
  const redisClients: any[] = [];

  afterEach(async () => {
    await Promise.all(children.map((c) => stopProcess(c.child)));
    children.length = 0;
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

  it("elects a single leader and fails over with a higher fencing token", async () => {
    const portA = await getFreePort();
    const portB = await getFreePort();
    const prefix = `forgeos:scheduler:leader:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

    const baseEnv = {
      HOST: "127.0.0.1",
      KAS_API_BASE: "http://127.0.0.1:9",
      SCHEDULER_TICK_MS: "60000",
      SCHEDULER_REDIS_URL: TEST_REDIS_URL,
      SCHEDULER_REDIS_PREFIX: prefix,
      SCHEDULER_REDIS_AUTHORITATIVE_QUEUE: "true",
      SCHEDULER_REDIS_RESET_EXEC_QUEUE_ON_BOOT: "false",
      SCHEDULER_AUTH_READS: "false",
      SCHEDULER_LEADER_LOCK_TTL_MS: "1000",
      SCHEDULER_LEADER_LOCK_RENEW_MS: "500",
      SCHEDULER_LEADER_LOCK_RENEW_JITTER_MS: "0",
      SCHEDULER_LEADER_ACQUIRE_BACKOFF_MIN_MS: "50",
      SCHEDULER_LEADER_ACQUIRE_BACKOFF_MAX_MS: "100",
    };

    const schedA = spawnNodeProcess(["server/scheduler/index.mjs"], {
      cwd: repoRoot,
      env: {
        ...baseEnv,
        PORT: String(portA),
        SCHEDULER_INSTANCE_ID: "sched-a",
      },
    });
    children.push(schedA);

    const schedB = spawnNodeProcess(["server/scheduler/index.mjs"], {
      cwd: repoRoot,
      env: {
        ...baseEnv,
        PORT: String(portB),
        SCHEDULER_INSTANCE_ID: "sched-b",
      },
    });
    children.push(schedB);

    const healthUrlA = `http://127.0.0.1:${portA}/health`;
    const healthUrlB = `http://127.0.0.1:${portB}/health`;
    await Promise.all([waitForHttp(healthUrlA), waitForHttp(healthUrlB)]);

    const redis = createClient({ url: TEST_REDIS_URL });
    redisClients.push(redis);
    await redis.connect();
    const leaderLockKey = `${prefix}:leader_lock`;
    const leaderFenceKey = `${prefix}:leader_fence`;

    let firstLeader: { key: "a" | "b"; port: number; instanceId: string; fenceToken: number } | null = null;
    await waitFor(async () => {
      const [ha, hb] = await Promise.all([httpJson(healthUrlA), httpJson(healthUrlB)]);
      const a = leaderHealthParts(ha.body);
      const b = leaderHealthParts(hb.body);
      const leaders = [
        ...(a.active ? [{ key: "a" as const, port: portA, ...a }] : []),
        ...(b.active ? [{ key: "b" as const, port: portB, ...b }] : []),
      ];
      if (leaders.length !== 1) return false;
      if (leaders[0].fenceToken < 1) return false;
      firstLeader = leaders[0];
      return true;
    }, 12_000, 100);

    expect(firstLeader).toBeTruthy();
    const first = firstLeader!;
    const firstFollowerPort = first.key === "a" ? portB : portA;

    const rawLeaderLock = await redis.get(leaderLockKey);
    const rawLeaderFence = await redis.get(leaderFenceKey);
    expect(String(rawLeaderLock || "")).toContain(`|${first.fenceToken}|`);
    expect(Number(rawLeaderFence || 0)).toBeGreaterThanOrEqual(first.fenceToken);

    const leaderChild = first.key === "a" ? schedA.child : schedB.child;
    await stopProcess(leaderChild);

    let secondLeaderFence = 0;
    await waitFor(async () => {
      const h = await httpJson(`http://127.0.0.1:${firstFollowerPort}/health`);
      const leader = leaderHealthParts(h.body);
      if (!leader.active) return false;
      if (leader.fenceToken <= first.fenceToken) return false;
      secondLeaderFence = leader.fenceToken;
      return true;
    }, 15_000, 100);

    const failoverHealth = await httpJson(`http://127.0.0.1:${firstFollowerPort}/health`);
    const failoverLeader = leaderHealthParts(failoverHealth.body);
    expect(failoverLeader.active).toBe(true);
    expect(failoverLeader.instanceId).not.toBe(first.instanceId);
    expect(failoverLeader.fenceToken).toBeGreaterThan(first.fenceToken);
    expect(secondLeaderFence).toBe(failoverLeader.fenceToken);

    const rawLeaderLockAfter = await redis.get(leaderLockKey);
    const rawLeaderFenceAfter = await redis.get(leaderFenceKey);
    expect(String(rawLeaderLockAfter || "")).toContain(failoverLeader.instanceId);
    expect(String(rawLeaderLockAfter || "")).toContain(`|${failoverLeader.fenceToken}|`);
    expect(Number(rawLeaderFenceAfter || 0)).toBeGreaterThanOrEqual(failoverLeader.fenceToken);

    const metricsText = await fetch(`http://127.0.0.1:${firstFollowerPort}/metrics`).then((r) => r.text());
    expect(metricsText).toMatch(/forgeos_scheduler_leader_active\s+1/);
    expect(metricsText).toMatch(/forgeos_scheduler_leader_fence_token\s+\d+/);
  }, 45_000);
});

