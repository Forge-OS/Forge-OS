export function newHistogram(buckets) {
  return { buckets: [...buckets].sort((a, b) => a - b), counts: new Map(), sum: 0, count: 0 };
}

export function observeHistogram(hist, ms) {
  const value = Math.max(0, Number(ms || 0));
  hist.sum += value;
  hist.count += 1;
  for (const bucket of hist.buckets) {
    if (value <= bucket) hist.counts.set(bucket, (hist.counts.get(bucket) || 0) + 1);
  }
}

export function inc(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

export function trackSchedulerLoad(params) {
  const {
    schedulerUsesRedisAuthoritativeQueue,
    metrics,
    cycleQueueLength,
    cycleInFlight,
    maxQueueDepth,
    schedulerSaturated,
    cycleConcurrency,
  } = params;
  const queueDepth = schedulerUsesRedisAuthoritativeQueue()
    ? Number(metrics.redisExecQueueReadyDepth || 0)
    : Math.max(0, Number(cycleQueueLength || 0));
  metrics.maxQueueDepthSeen = Math.max(metrics.maxQueueDepthSeen, queueDepth);
  metrics.maxInFlightSeen = Math.max(metrics.maxInFlightSeen, Math.max(0, Number(cycleInFlight || 0)));
  const queueRatio = maxQueueDepth > 0 ? queueDepth / maxQueueDepth : 0;
  const saturated = queueRatio >= 0.8 || (cycleInFlight >= cycleConcurrency && queueDepth > 0);
  if (saturated && !schedulerSaturated) metrics.schedulerSaturationEventsTotal += 1;
  return saturated;
}

export function recordHttp(params) {
  const { metrics, routeKey, statusCode, startedAtMs, incFn = inc } = params;
  metrics.httpRequestsTotal += 1;
  incFn(metrics.httpResponsesByRouteStatus, `${routeKey}|${statusCode}`);
  if (startedAtMs > 0) {
    // Keep counters only on HTTP path; upstream/callback histograms are tracked separately.
  }
}
