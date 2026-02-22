export function createSchedulerCallbacksController(deps) {
  const {
    metrics,
    observeHistogram,
    nowMs,
    CALLBACK_TIMEOUT_MS,
    redisOp,
    getRedisClient,
    REDIS_KEYS,
    INSTANCE_ID,
    callbackIdempotencyMemory,
    CALLBACK_IDEMPOTENCY_TTL_MS,
    CALLBACK_IDEMPOTENCY_LEASE_MS,
  } = deps;

  async function postCallback(url, payload) {
    const started = nowMs();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CALLBACK_TIMEOUT_MS);
    try {
      const extraHeaders = payload?.scheduler?.callbackHeaders && typeof payload.scheduler.callbackHeaders === "object"
        ? payload.scheduler.callbackHeaders
        : null;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(extraHeaders || {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      observeHistogram(metrics.callbackLatencyMs, nowMs() - started);
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`callback_${res.status}:${txt.slice(0, 180)}`);
      }
      metrics.callbackSuccessTotal += 1;
      return true;
    } catch (e) {
      observeHistogram(metrics.callbackLatencyMs, nowMs() - started);
      metrics.callbackErrorTotal += 1;
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function callbackDedupeDoneKey(idempotencyKey) {
    return `${REDIS_KEYS.callbackDedupePrefix}:${idempotencyKey}:done`;
  }

  function callbackDedupeLeaseKey(idempotencyKey) {
    return `${REDIS_KEYS.callbackDedupePrefix}:${idempotencyKey}:lease`;
  }

  async function beginCallbackIdempotency(idempotencyKey) {
    const key = String(idempotencyKey || "").trim();
    if (!key) return { shouldSend: true, leaseToken: "", mode: "noop" };
    const leaseToken = `${INSTANCE_ID}:${nowMs()}:${Math.random().toString(36).slice(2, 10)}`;
    if (getRedisClient()) {
      const doneExists = await redisOp("callback_dedupe_done_exists", (r) => r.exists(callbackDedupeDoneKey(key)));
      if (doneExists == null) return { shouldSend: true, leaseToken, mode: "redis_fail_open" };
      if (Number(doneExists) > 0) return { shouldSend: false, leaseToken: "", mode: "redis_done" };
      const leaseOk = await redisOp("callback_dedupe_lease_set_nx", (r) =>
        r.set(callbackDedupeLeaseKey(key), leaseToken, { NX: true, PX: CALLBACK_IDEMPOTENCY_LEASE_MS })
      );
      if (leaseOk == null) return { shouldSend: true, leaseToken, mode: "redis_fail_open" };
      if (leaseOk !== "OK") return { shouldSend: false, leaseToken: "", mode: "redis_inflight" };
      const doneAfterLease = await redisOp("callback_dedupe_done_exists", (r) => r.exists(callbackDedupeDoneKey(key)));
      if (doneAfterLease == null) return { shouldSend: true, leaseToken, mode: "redis_fail_open" };
      if (Number(doneAfterLease) > 0) {
        await redisOp("callback_dedupe_lease_release_done", (r) => r.del(callbackDedupeLeaseKey(key)));
        return { shouldSend: false, leaseToken: "", mode: "redis_done_after_lease" };
      }
      return { shouldSend: true, leaseToken, mode: "redis_lease" };
    }
    const now = nowMs();
    const prev = callbackIdempotencyMemory.get(key);
    if (prev) {
      if (prev.state === "done" && now < Number(prev.expAt || 0)) return { shouldSend: false, leaseToken: "", mode: "memory_done" };
      if (prev.state === "lease" && now < Number(prev.leaseExpAt || 0)) return { shouldSend: false, leaseToken: "", mode: "memory_inflight" };
    }
    callbackIdempotencyMemory.set(key, {
      state: "lease",
      leaseToken,
      leaseExpAt: now + CALLBACK_IDEMPOTENCY_LEASE_MS,
      expAt: now + CALLBACK_IDEMPOTENCY_TTL_MS,
    });
    if (callbackIdempotencyMemory.size > 50_000) {
      for (const [k, v] of callbackIdempotencyMemory.entries()) {
        if (!v || now >= Number(v.expAt || v.leaseExpAt || 0)) callbackIdempotencyMemory.delete(k);
        if (callbackIdempotencyMemory.size <= 50_000) break;
      }
    }
    return { shouldSend: true, leaseToken, mode: "memory_lease" };
  }

  async function completeCallbackIdempotency(idempotencyKey, leaseToken) {
    const key = String(idempotencyKey || "").trim();
    if (!key) return;
    const token = String(leaseToken || "").trim();
    if (getRedisClient()) {
      if (!token) return;
      const leaseKey = callbackDedupeLeaseKey(key);
      const doneKey = callbackDedupeDoneKey(key);
      const currentLease = await redisOp("callback_dedupe_lease_get", (r) => r.get(leaseKey));
      if (currentLease == null) return;
      if (String(currentLease) !== token) return;
      await redisOp("callback_dedupe_mark_done", async (r) => {
        const multi = r.multi();
        multi.set(doneKey, "1", { PX: CALLBACK_IDEMPOTENCY_TTL_MS });
        multi.del(leaseKey);
        return multi.exec();
      });
      return;
    }
    const now = nowMs();
    const prev = callbackIdempotencyMemory.get(key);
    if (!prev || prev.state !== "lease") return;
    if (String(prev.leaseToken || "") !== token) return;
    callbackIdempotencyMemory.set(key, { state: "done", expAt: now + CALLBACK_IDEMPOTENCY_TTL_MS });
  }

  async function releaseCallbackIdempotencyLease(idempotencyKey, leaseToken) {
    const key = String(idempotencyKey || "").trim();
    if (!key) return;
    const token = String(leaseToken || "").trim();
    if (getRedisClient()) {
      if (!token) return;
      const leaseKey = callbackDedupeLeaseKey(key);
      const currentLease = await redisOp("callback_dedupe_lease_get", (r) => r.get(leaseKey));
      if (currentLease == null) return;
      if (String(currentLease) !== token) return;
      await redisOp("callback_dedupe_lease_release", (r) => r.del(leaseKey));
      return;
    }
    const prev = callbackIdempotencyMemory.get(key);
    if (!prev || prev.state !== "lease") return;
    if (String(prev.leaseToken || "") !== token) return;
    callbackIdempotencyMemory.delete(key);
  }

  return {
    postCallback,
    callbackDedupeDoneKey,
    callbackDedupeLeaseKey,
    beginCallbackIdempotency,
    completeCallbackIdempotency,
    releaseCallbackIdempotencyLease,
  };
}
