export function createSchedulerRedisQueueController(deps) {
  const {
    metrics,
    redisOp,
    getRedisClient,
    REDIS_KEYS,
    REDIS_AUTHORITATIVE_QUEUE,
    INSTANCE_ID,
    getLeaderFenceToken,
    nowMs,
    randomUUID,
    trackSchedulerLoad,
    cycleQueue,
    MAX_QUEUE_DEPTH,
    REDIS_EXEC_LEASE_TTL_MS,
    REDIS_EXEC_REQUEUE_BATCH,
  } = deps;

  function schedulerUsesRedisAuthoritativeQueue() {
    return Boolean(getRedisClient() && metrics.redisConnected && REDIS_AUTHORITATIVE_QUEUE);
  }

  function leaseKeyForAgent(queueKey) {
    return `${REDIS_KEYS.leasesPrefix}:${queueKey}`;
  }

  function execLeaseKeyForTask(taskId) {
    return `${REDIS_KEYS.execLeasesPrefix}:${taskId}`;
  }

  function execAgentTasksKey(queueKey) {
    return `${REDIS_KEYS.execAgentTasksPrefix}:${String(queueKey || "")}`;
  }

  function buildAgentCycleTask(queueKey) {
    return {
      id: randomUUID(),
      kind: "agent_cycle",
      queueKey: String(queueKey || ""),
      enqueuedAt: nowMs(),
      leaderFenceToken: Math.max(0, Number(getLeaderFenceToken() || 0)),
      instanceId: INSTANCE_ID,
    };
  }

  function parseExecutionTask(raw) {
    if (!raw) return null;
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!parsed || String(parsed?.kind || "") !== "agent_cycle") return null;
      const queueKey = String(parsed?.queueKey || "").trim();
      if (!queueKey) return null;
      return {
        id: String(parsed?.id || "").trim() || randomUUID(),
        kind: "agent_cycle",
        queueKey,
        enqueuedAt: Number(parsed?.enqueuedAt || nowMs()),
        leaderFenceToken: Math.max(0, Number(parsed?.leaderFenceToken || 0)),
        instanceId: String(parsed?.instanceId || "").slice(0, 120),
      };
    } catch {
      return null;
    }
  }

  async function refreshRedisExecutionQueueMetrics() {
    if (!schedulerUsesRedisAuthoritativeQueue()) {
      metrics.redisExecQueueReadyDepth = 0;
      metrics.redisExecQueueProcessingDepth = 0;
      metrics.redisExecQueueInflightDepth = 0;
      trackSchedulerLoad();
      return;
    }
    const [ready, processing, inflight] = await Promise.all([
      redisOp("llen_exec_ready", (r) => r.lLen(REDIS_KEYS.queue)),
      redisOp("llen_exec_processing", (r) => r.lLen(REDIS_KEYS.queueProcessing)),
      redisOp("zcard_exec_inflight", (r) => r.zCard(REDIS_KEYS.queueInflight)),
    ]);
    metrics.redisExecQueueReadyDepth = Math.max(0, Number(ready || 0));
    metrics.redisExecQueueProcessingDepth = Math.max(0, Number(processing || 0));
    metrics.redisExecQueueInflightDepth = Math.max(0, Number(inflight || 0));
    trackSchedulerLoad();
  }

  async function rebuildRedisExecutionTaskIndexesOnBoot() {
    if (!schedulerUsesRedisAuthoritativeQueue()) return;
    const payloads = await redisOp("hGetAll_exec_payloads_rebuild_indexes", (r) => r.hGetAll(REDIS_KEYS.queuePayloads));
    if (!payloads || typeof payloads !== "object") return;

    const ownerMap = {};
    const byAgent = new Map();
    for (const [taskId, rawPayload] of Object.entries(payloads)) {
      const task = parseExecutionTask(rawPayload);
      if (!task) continue;
      const id = String(taskId || "").trim();
      const queueKey = String(task.queueKey || "").trim();
      if (!id || !queueKey) continue;
      ownerMap[id] = queueKey;
      const ids = byAgent.get(queueKey) || [];
      ids.push(id);
      byAgent.set(queueKey, ids);
    }

    await redisOp("del_exec_task_owners_rebuild", (r) => r.del(REDIS_KEYS.queueTaskOwners));
    if (Object.keys(ownerMap).length) {
      await redisOp("hSet_exec_task_owners_rebuild", (r) => r.hSet(REDIS_KEYS.queueTaskOwners, ownerMap));
    }
    for (const [queueKey, ids] of byAgent.entries()) {
      if (!ids.length) continue;
      await redisOp("sAdd_exec_agent_tasks_rebuild", (r) => r.sAdd(execAgentTasksKey(queueKey), ids));
    }
  }

  async function enqueueRedisExecutionTask(task) {
    if (!schedulerUsesRedisAuthoritativeQueue()) throw new Error("redis_execution_queue_unavailable");
    const parsedTask = parseExecutionTask(task);
    if (!parsedTask) throw new Error("invalid_execution_task");

    const payload = JSON.stringify(parsedTask);
    const taskId = parsedTask.id;
    const queueKey = parsedTask.queueKey;
    const enqueueResult = await redisOp("enqueue_exec_task_atomic", (r) =>
      r.eval(
        `
          local readyKey = KEYS[1]
          local inflightKey = KEYS[2]
          local payloadsKey = KEYS[3]
          local ownersKey = KEYS[4]
          local agentTasksKey = KEYS[5]
          local taskId = ARGV[1]
          local payload = ARGV[2]
          local maxDepth = tonumber(ARGV[3])
          local queueKey = ARGV[4]
          local readyDepth = tonumber(redis.call("LLEN", readyKey) or "0")
          local inflightDepth = tonumber(redis.call("ZCARD", inflightKey) or "0")
          if (readyDepth + inflightDepth) >= maxDepth then
            return {"FULL", tostring(readyDepth + inflightDepth)}
          end
          redis.call("HSET", payloadsKey, taskId, payload)
          redis.call("HSET", ownersKey, taskId, queueKey)
          redis.call("SADD", agentTasksKey, taskId)
          redis.call("RPUSH", readyKey, taskId)
          return {"OK", tostring(readyDepth + inflightDepth + 1)}
        `,
        {
          keys: [REDIS_KEYS.queue, REDIS_KEYS.queueInflight, REDIS_KEYS.queuePayloads, REDIS_KEYS.queueTaskOwners, execAgentTasksKey(queueKey)],
          arguments: [taskId, payload, String(MAX_QUEUE_DEPTH), queueKey],
        }
      )
    );
    if (!Array.isArray(enqueueResult) || !enqueueResult[0]) throw new Error("redis_execution_enqueue_failed");
    if (String(enqueueResult[0] || "").toUpperCase() === "FULL") {
      metrics.queueFullTotal += 1;
      await refreshRedisExecutionQueueMetrics();
      throw new Error("scheduler_queue_full");
    }
    metrics.dispatchQueuedTotal += 1;
    await refreshRedisExecutionQueueMetrics();
  }

  async function claimRedisExecutionTask() {
    if (!schedulerUsesRedisAuthoritativeQueue()) return null;
    const leaseOwner = JSON.stringify({
      instanceId: INSTANCE_ID,
      leaderFenceToken: Math.max(0, Number(getLeaderFenceToken() || 0)),
      ts: nowMs(),
    });
    const now = nowMs();
    const script = `
      local id = redis.call("LPOP", KEYS[1])
      if not id then
        return nil
      end
      redis.call("RPUSH", KEYS[2], id)
      local payload = redis.call("HGET", KEYS[3], id)
      if not payload then
        redis.call("LREM", KEYS[2], 1, id)
        return {id, ""}
      end
      redis.call("SET", ARGV[1] .. id, ARGV[2], "PX", tonumber(ARGV[3]))
      redis.call("ZADD", KEYS[4], tonumber(ARGV[4]), id)
      return {id, payload}
    `;
    const result = await redisOp("claim_exec_task", (r) =>
      r.eval(script, {
        keys: [REDIS_KEYS.queue, REDIS_KEYS.queueProcessing, REDIS_KEYS.queuePayloads, REDIS_KEYS.queueInflight],
        arguments: [
          `${REDIS_KEYS.execLeasesPrefix}:`,
          leaseOwner,
          String(REDIS_EXEC_LEASE_TTL_MS),
          String(now + REDIS_EXEC_LEASE_TTL_MS),
        ],
      })
    );
    if (!Array.isArray(result) || !result[0]) {
      await refreshRedisExecutionQueueMetrics();
      return null;
    }
    const taskId = String(result[0] || "").trim();
    const payload = String(result[1] || "");
    if (!taskId || !payload) {
      await ackRedisExecutionTask(taskId);
      return null;
    }
    const task = parseExecutionTask(payload);
    if (!task) {
      await ackRedisExecutionTask(taskId);
      return null;
    }
    metrics.redisExecClaimedTotal += 1;
    await refreshRedisExecutionQueueMetrics();
    return task;
  }

  async function ackRedisExecutionTask(taskId) {
    const id = String(taskId || "").trim();
    if (!schedulerUsesRedisAuthoritativeQueue() || !id) return;
    const script = `
      redis.call("LREM", KEYS[1], 1, ARGV[1])
      redis.call("ZREM", KEYS[2], ARGV[1])
      redis.call("HDEL", KEYS[3], ARGV[1])
      local owner = redis.call("HGET", KEYS[4], ARGV[1])
      if owner then
        redis.call("SREM", ARGV[3] .. ":" .. owner, ARGV[1])
        redis.call("HDEL", KEYS[4], ARGV[1])
      end
      redis.call("DEL", ARGV[2] .. ARGV[1])
      return 1
    `;
    await redisOp("ack_exec_task", (r) =>
      r.eval(script, {
        keys: [REDIS_KEYS.queueProcessing, REDIS_KEYS.queueInflight, REDIS_KEYS.queuePayloads, REDIS_KEYS.queueTaskOwners],
        arguments: [id, `${REDIS_KEYS.execLeasesPrefix}:`, REDIS_KEYS.execAgentTasksPrefix],
      })
    );
    metrics.redisExecAckedTotal += 1;
    await refreshRedisExecutionQueueMetrics();
  }

  async function requeueExpiredRedisExecutionTasks(limit = REDIS_EXEC_REQUEUE_BATCH) {
    if (!schedulerUsesRedisAuthoritativeQueue()) return 0;
    const expiredIds = await redisOp("zRangeByScore_exec_inflight_expired", (r) =>
      r.zRangeByScore(REDIS_KEYS.queueInflight, 0, nowMs(), { LIMIT: { offset: 0, count: limit } })
    );
    if (!Array.isArray(expiredIds) || !expiredIds.length) return 0;
    let requeued = 0;
    for (const rawId of expiredIds) {
      const id = String(rawId || "").trim();
      if (!id) continue;
      const result = await redisOp("requeue_expired_exec_task_atomic", (r) =>
        r.eval(
          `
            local inflightKey = KEYS[1]
            local processingKey = KEYS[2]
            local payloadsKey = KEYS[3]
            local readyKey = KEYS[4]
            local leaseKey = ARGV[1]
            local id = ARGV[2]
            if redis.call("EXISTS", leaseKey) == 1 then
              return {"LEASED"}
            end
            local inflightScore = redis.call("ZSCORE", inflightKey, id)
            if not inflightScore then
              redis.call("LREM", processingKey, 1, id)
              return {"MISSING"}
            end
            local hasPayload = redis.call("HEXISTS", payloadsKey, id)
            redis.call("ZREM", inflightKey, id)
            redis.call("LREM", processingKey, 1, id)
            if hasPayload == 1 then
              redis.call("RPUSH", readyKey, id)
              return {"REQUEUED"}
            end
            redis.call("DEL", leaseKey)
            return {"DROPPED_NO_PAYLOAD"}
          `,
          {
            keys: [REDIS_KEYS.queueInflight, REDIS_KEYS.queueProcessing, REDIS_KEYS.queuePayloads, REDIS_KEYS.queue],
            arguments: [execLeaseKeyForTask(id), id],
          }
        )
      );
      const decision = String(Array.isArray(result) ? result[0] || "" : "").toUpperCase();
      if (decision === "REQUEUED") {
        requeued += 1;
        metrics.redisExecRequeuedExpiredTotal += 1;
      }
    }
    if (requeued > 0) await refreshRedisExecutionQueueMetrics();
    return requeued;
  }

  async function recoverRedisExecutionQueueOnBoot() {
    if (!schedulerUsesRedisAuthoritativeQueue()) return;
    let recovered = 0;
    while (true) {
      const batch = await redisOp("recover_exec_processing_batch_atomic", (r) =>
        r.eval(
          `
            local processingKey = KEYS[1]
            local inflightKey = KEYS[2]
            local payloadsKey = KEYS[3]
            local readyKey = KEYS[4]
            local leasePrefix = ARGV[1]
            local limit = tonumber(ARGV[2] or "256")
            local ids = redis.call("LRANGE", processingKey, 0, math.max(0, limit - 1))
            if not ids or #ids == 0 then
              return {"0","0","0","0"}
            end
            local seen = {}
            local recovered = 0
            local dropped = 0
            local leased = 0
            for _, id in ipairs(ids) do
              if id and id ~= "" and not seen[id] then
                seen[id] = true
                local leaseKey = leasePrefix .. id
                if redis.call("EXISTS", leaseKey) == 1 then
                  leased = leased + 1
                else
                  local hasPayload = redis.call("HEXISTS", payloadsKey, id)
                  redis.call("LREM", processingKey, 0, id)
                  redis.call("ZREM", inflightKey, id)
                  if hasPayload == 1 then
                    redis.call("RPUSH", readyKey, id)
                    recovered = recovered + 1
                  else
                    redis.call("DEL", leaseKey)
                    dropped = dropped + 1
                  end
                end
              end
            end
            return {tostring(recovered), tostring(dropped), tostring(leased), tostring(#ids)}
          `,
          {
            keys: [REDIS_KEYS.queueProcessing, REDIS_KEYS.queueInflight, REDIS_KEYS.queuePayloads, REDIS_KEYS.queue],
            arguments: [`${REDIS_KEYS.execLeasesPrefix}:`, String(Math.max(32, REDIS_EXEC_REQUEUE_BATCH * 8))],
          }
        )
      );
      const recoveredBatch = Math.max(0, Number(Array.isArray(batch) ? batch[0] : 0));
      const droppedBatch = Math.max(0, Number(Array.isArray(batch) ? batch[1] : 0));
      const leasedBatch = Math.max(0, Number(Array.isArray(batch) ? batch[2] : 0));
      const scannedBatch = Math.max(0, Number(Array.isArray(batch) ? batch[3] : 0));
      recovered += recoveredBatch;
      if (recovered > MAX_QUEUE_DEPTH * 2) break;
      if (scannedBatch <= 0) break;
      if ((recoveredBatch + droppedBatch) <= 0 && leasedBatch > 0) break;
    }
    let requeuedBatch = 0;
    while ((requeuedBatch = await requeueExpiredRedisExecutionTasks(REDIS_EXEC_REQUEUE_BATCH)) > 0) {
      recovered += requeuedBatch;
      if (recovered > MAX_QUEUE_DEPTH * 2) break;
    }
    metrics.redisExecRecoveredOnBootTotal += recovered;
    await refreshRedisExecutionQueueMetrics();
  }

  function removeLocalQueuedTasksForAgent(queueKey) {
    const key = String(queueKey || "");
    if (!key) return;
    let changed = false;
    for (let i = cycleQueue.length - 1; i >= 0; i -= 1) {
      if (String(cycleQueue[i]?.queueKey || "") === key) {
        cycleQueue.splice(i, 1);
        changed = true;
      }
    }
    if (changed) trackSchedulerLoad();
  }

  async function removeRedisQueuedTasksForAgent(queueKey) {
    const key = String(queueKey || "");
    if (!schedulerUsesRedisAuthoritativeQueue() || !key) return;
    const agentTasksKey = execAgentTasksKey(key);
    while (true) {
      const result = await redisOp("remove_agent_exec_tasks_batch_atomic", (r) =>
        r.eval(
          `
            local agentSetKey = KEYS[1]
            local readyKey = KEYS[2]
            local processingKey = KEYS[3]
            local inflightKey = KEYS[4]
            local payloadsKey = KEYS[5]
            local ownersKey = KEYS[6]
            local leasePrefix = ARGV[1]
            local queueKey = ARGV[2]
            local limit = tonumber(ARGV[3] or "256")
            local ids = redis.call("SMEMBERS", agentSetKey)
            if not ids or #ids == 0 then
              return {"0","0","0","0","0"}
            end
            local removed = 0
            local leased = 0
            local mismatched = 0
            local scanned = 0
            for _, id in ipairs(ids) do
              if scanned >= limit then break end
              scanned = scanned + 1
              local owner = redis.call("HGET", ownersKey, id)
              if owner and owner ~= queueKey then
                redis.call("SREM", agentSetKey, id)
                mismatched = mismatched + 1
              else
                local leaseKey = leasePrefix .. id
                if redis.call("EXISTS", leaseKey) == 1 then
                  leased = leased + 1
                else
                  redis.call("LREM", readyKey, 0, id)
                  redis.call("LREM", processingKey, 0, id)
                  redis.call("ZREM", inflightKey, id)
                  redis.call("HDEL", payloadsKey, id)
                  redis.call("HDEL", ownersKey, id)
                  redis.call("SREM", agentSetKey, id)
                  redis.call("DEL", leaseKey)
                  removed = removed + 1
                end
              end
            end
            local remaining = tonumber(redis.call("SCARD", agentSetKey) or "0")
            if remaining == 0 then
              redis.call("DEL", agentSetKey)
            end
            return {tostring(removed), tostring(leased), tostring(mismatched), tostring(scanned), tostring(remaining)}
          `,
          {
            keys: [
              agentTasksKey,
              REDIS_KEYS.queue,
              REDIS_KEYS.queueProcessing,
              REDIS_KEYS.queueInflight,
              REDIS_KEYS.queuePayloads,
              REDIS_KEYS.queueTaskOwners,
            ],
            arguments: [`${REDIS_KEYS.execLeasesPrefix}:`, key, "256"],
          }
        )
      );
      const removed = Math.max(0, Number(Array.isArray(result) ? result[0] : 0));
      const leased = Math.max(0, Number(Array.isArray(result) ? result[1] : 0));
      const mismatched = Math.max(0, Number(Array.isArray(result) ? result[2] : 0));
      const scanned = Math.max(0, Number(Array.isArray(result) ? result[3] : 0));
      const remaining = Math.max(0, Number(Array.isArray(result) ? result[4] : 0));
      if (remaining <= 0 || scanned <= 0) break;
      if (removed <= 0 && mismatched <= 0 && leased > 0) break;
    }
    await refreshRedisExecutionQueueMetrics();
  }

  return {
    schedulerUsesRedisAuthoritativeQueue,
    leaseKeyForAgent,
    execLeaseKeyForTask,
    execAgentTasksKey,
    buildAgentCycleTask,
    parseExecutionTask,
    refreshRedisExecutionQueueMetrics,
    rebuildRedisExecutionTaskIndexesOnBoot,
    enqueueRedisExecutionTask,
    claimRedisExecutionTask,
    ackRedisExecutionTask,
    requeueExpiredRedisExecutionTasks,
    recoverRedisExecutionQueueOnBoot,
    removeLocalQueuedTasksForAgent,
    removeRedisQueuedTasksForAgent,
  };
}
