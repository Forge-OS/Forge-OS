export function createLeaderLockController(deps) {
  const {
    metrics,
    redisOp,
    getRedisClient,
    REDIS_KEYS,
    INSTANCE_ID,
    schedulerUsesRedisAuthoritativeQueue,
    nowMs,
    jitterMs,
    randomUUID,
    LEADER_LOCK_TTL_MS,
    LEADER_LOCK_RENEW_MS,
    LEADER_LOCK_RENEW_JITTER_MS,
    LEADER_ACQUIRE_BACKOFF_MIN_MS,
    LEADER_ACQUIRE_BACKOFF_MAX_MS,
    getState,
    setState,
  } = deps;

  function scheduleNextLeaderRenewAt() {
    setState({
      leaderNextRenewAt: nowMs() + LEADER_LOCK_RENEW_MS + jitterMs(LEADER_LOCK_RENEW_JITTER_MS),
    });
  }

  function resetLeaderBackoff() {
    setState({
      leaderAcquireBackoffMs: 0,
      leaderAcquireBackoffUntil: 0,
    });
  }

  function bumpLeaderAcquireBackoff() {
    const state = getState();
    const current = Math.max(0, Number(state?.leaderAcquireBackoffMs || 0));
    const base = current > 0
      ? Math.min(LEADER_ACQUIRE_BACKOFF_MAX_MS, current * 2)
      : LEADER_ACQUIRE_BACKOFF_MIN_MS;
    setState({
      leaderAcquireBackoffMs: base,
      leaderAcquireBackoffUntil: nowMs() + base + jitterMs(Math.floor(base / 2)),
    });
    metrics.leaderAcquireBackoffTotal += 1;
  }

  async function acquireOrRenewLeaderLock() {
    let state = getState();
    if (!schedulerUsesRedisAuthoritativeQueue()) {
      if (state.isLeader) {
        setState({ isLeader: false });
        metrics.leaderTransitionsTotal += 1;
      }
      setState({
        leaderLockValue: "",
        leaderFenceToken: 0,
      });
      metrics.leaderFenceToken = 0;
      return false;
    }

    const now = nowMs();
    state = getState();
    if (!state.isLeader && Number(state.leaderAcquireBackoffUntil || 0) > now) return false;

    const token = String(state.leaderLockToken || "") || `${INSTANCE_ID}:${randomUUID()}`;
    if (!state.leaderLockToken) {
      setState({ leaderLockToken: token });
    }
    const lockKey = REDIS_KEYS.leaderLock;

    state = getState();
    if (state.isLeader) {
      if (Number(state.leaderNextRenewAt || 0) > 0 && now < Number(state.leaderNextRenewAt || 0)) return true;
      const renewed = await redisOp("renew_leader_lock", (r) =>
        r.eval(
          `
            if redis.call("GET", KEYS[1]) == ARGV[1] then
              return redis.call("PEXPIRE", KEYS[1], tonumber(ARGV[2]))
            end
            return 0
          `,
          { keys: [lockKey], arguments: [String(getState().leaderLockValue || ""), String(LEADER_LOCK_TTL_MS)] }
        )
      );
      if (Number(renewed || 0) > 0) {
        const currentFence = Math.max(0, Number(getState().leaderFenceToken || 0));
        setState({
          leaderLastRenewedAt: nowMs(),
        });
        metrics.leaderFenceToken = currentFence;
        scheduleNextLeaderRenewAt();
        resetLeaderBackoff();
        return true;
      }
      setState({
        isLeader: false,
        leaderLockValue: "",
        leaderFenceToken: 0,
      });
      metrics.leaderFenceToken = 0;
      metrics.leaderRenewFailedTotal += 1;
      metrics.leaderTransitionsTotal += 1;
      bumpLeaderAcquireBackoff();
    }

    const latestState = getState();
    const activeToken = String(latestState.leaderLockToken || "") || token;
    const acquired = await redisOp("acquire_leader_lock", (r) =>
      r.eval(
        `
          local current = redis.call("GET", KEYS[1])
          if current then
            return {0, current}
          end
          local fence = redis.call("INCR", KEYS[2])
          local value = ARGV[1] .. "|" .. tostring(fence) .. "|" .. ARGV[3]
          redis.call("SET", KEYS[1], value, "PX", tonumber(ARGV[2]))
          return {1, tostring(fence), value}
        `,
        {
          keys: [lockKey, REDIS_KEYS.leaderFence],
          arguments: [activeToken, String(LEADER_LOCK_TTL_MS), INSTANCE_ID],
        }
      )
    );

    if (Array.isArray(acquired) && Number(acquired[0] || 0) === 1) {
      const fenceToken = Math.max(0, Number(acquired[1] || 0));
      setState({
        isLeader: true,
        leaderFenceToken: fenceToken,
        leaderLockValue: String(acquired[2] || `${activeToken}|${fenceToken}|${INSTANCE_ID}`),
        leaderLastRenewedAt: nowMs(),
      });
      metrics.leaderFenceToken = fenceToken;
      metrics.leaderAcquiredTotal += 1;
      metrics.leaderTransitionsTotal += 1;
      scheduleNextLeaderRenewAt();
      resetLeaderBackoff();
      return true;
    }

    bumpLeaderAcquireBackoff();
    return false;
  }

  async function releaseLeaderLock() {
    if (!getRedisClient() || !String(getState().leaderLockToken || "").trim()) return;
    const state = getState();
    const value = String(state.leaderLockValue || "");
    if (!value) {
      if (state.isLeader) {
        setState({ isLeader: false });
        metrics.leaderTransitionsTotal += 1;
      }
      return;
    }
    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      end
      return 0
    `;
    await redisOp("release_leader_lock", (r) => r.eval(script, { keys: [REDIS_KEYS.leaderLock], arguments: [value] }));
    const after = getState();
    if (after.isLeader) {
      setState({ isLeader: false });
      metrics.leaderTransitionsTotal += 1;
    }
    setState({
      leaderFenceToken: 0,
      leaderLockValue: "",
      leaderNextRenewAt: 0,
    });
    metrics.leaderFenceToken = 0;
  }

  return {
    scheduleNextLeaderRenewAt,
    resetLeaderBackoff,
    bumpLeaderAcquireBackoff,
    acquireOrRenewLeaderLock,
    releaseLeaderLock,
  };
}
