import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";

const REPO_ROOT = process.cwd();
const HOST = "127.0.0.1";
const SOURCE_ADDRESS = "kaspa:qqkqkzjvr7zwxxmjxjkmxxdwju9kjs6e9u82uh59z07vgaks6gg62v8707g73";
const TREASURY_ADDRESS = "kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85";

const cfg = {
  agents: Math.max(1, Number(process.env.LOAD_PIPELINE_AGENTS || 24)),
  schedulerTicks: Math.max(1, Number(process.env.LOAD_PIPELINE_TICKS || 24)),
  receiptPosts: Math.max(1, Number(process.env.LOAD_PIPELINE_RECEIPTS || 80)),
  txBuilderRequests: Math.max(1, Number(process.env.LOAD_PIPELINE_TX_BUILDS || 40)),
  concurrency: Math.max(1, Number(process.env.LOAD_PIPELINE_CONCURRENCY || 8)),
  schedulerInstances: Math.max(1, Number(process.env.LOAD_PIPELINE_SCHEDULER_INSTANCES || 1)),
  txBuilderMode: String(process.env.LOAD_PIPELINE_TX_BUILDER_MODE || "local-wasm").trim().toLowerCase(), // local-wasm | command-mock
  schedulerRedisUrl: String(process.env.LOAD_PIPELINE_SCHEDULER_REDIS_URL || "").trim(),
  callbackRedisUrl: String(process.env.LOAD_PIPELINE_CALLBACK_REDIS_URL || "").trim(),
  schedulerRedisPrefix: String(process.env.LOAD_PIPELINE_SCHEDULER_REDIS_PREFIX || "").trim(),
  callbackRedisPrefix: String(process.env.LOAD_PIPELINE_CALLBACK_REDIS_PREFIX || "").trim(),
  thresholds: {
    schedulerTickP95Ms: Math.max(0, Number(process.env.LOAD_PIPELINE_MAX_P95_SCHEDULER_TICK_MS || 0)),
    receiptPostP95Ms: Math.max(0, Number(process.env.LOAD_PIPELINE_MAX_P95_RECEIPT_POST_MS || 0)),
    txBuilderP95Ms: Math.max(0, Number(process.env.LOAD_PIPELINE_MAX_P95_TX_BUILDER_MS || 0)),
    schedulerCallbackP95BucketMs: Math.max(0, Number(process.env.LOAD_PIPELINE_MAX_P95_SCHEDULER_CALLBACK_MS || 0)),
    schedulerSaturationEvents: Math.max(0, Number(process.env.LOAD_PIPELINE_MAX_SCHEDULER_SATURATION_EVENTS || 0)),
    callbackDuplicateEvents: Number(
      process.env.LOAD_PIPELINE_MAX_CALLBACK_DUPLICATE_EVENTS == null
        ? -1
        : process.env.LOAD_PIPELINE_MAX_CALLBACK_DUPLICATE_EVENTS
    ),
    callbackStaleFenceEvents: Number(
      process.env.LOAD_PIPELINE_MAX_CALLBACK_STALE_FENCE_EVENTS == null
        ? -1
        : process.env.LOAD_PIPELINE_MAX_CALLBACK_STALE_FENCE_EVENTS
    ),
    totalErrors: Math.max(0, Number(process.env.LOAD_PIPELINE_MAX_TOTAL_ERRORS || 0)),
    errorRatePct: Math.max(0, Number(process.env.LOAD_PIPELINE_MAX_ERROR_RATE_PCT || 0)),
  },
};

function nowMs() {
  return Date.now();
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, HOST, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function spawnNode(args, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => { stdout += String(d); });
  child.stderr.on("data", (d) => { stderr += String(d); });
  return { child, stdout: () => stdout, stderr: () => stderr };
}

async function stopProc(proc, timeoutMs = 2500) {
  if (!proc?.child || proc.child.exitCode != null) return;
  proc.child.kill("SIGTERM");
  await new Promise((resolve) => {
    const t = setTimeout(() => {
      try { proc.child.kill("SIGKILL"); } catch {}
      resolve();
    }, timeoutMs);
    proc.child.once("exit", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

async function waitForHttp(url, timeoutMs = 10_000) {
  const started = nowMs();
  let lastErr = null;
  while (nowMs() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastErr = new Error(`status_${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw lastErr || new Error(`wait_for_http_timeout:${url}`);
}

async function httpJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { res, body, text };
}

async function startJsonServer(port, handler) {
  const server = http.createServer(async (req, res) => {
    try {
      let raw = "";
      req.on("data", (chunk) => { raw += String(chunk); });
      await new Promise((resolve, reject) => {
        req.on("end", resolve);
        req.on("error", reject);
      });
      const body = raw ? JSON.parse(raw) : {};
      const url = new URL(req.url || "/", `http://${req.headers.host || HOST}`);
      const out = (await handler(req, body, url)) || {};
      const status = Number(out.status || 200);
      const headers = { "Content-Type": "application/json", ...(out.headers || {}) };
      res.writeHead(status, headers);
      res.end(JSON.stringify(out.body ?? { ok: true }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e?.message || e || "server_error") }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => resolve());
  });
  return server;
}

function stats(values) {
  if (!values.length) return { count: 0, min: 0, p50: 0, p95: 0, p99: 0, max: 0, avg: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    min: sorted[0],
    p50: pick(0.5),
    p95: pick(0.95),
    p99: pick(0.99),
    max: sorted[sorted.length - 1],
    avg: Number((sum / sorted.length).toFixed(2)),
  };
}

function thresholdFailures(summary) {
  const out = [];
  const t = cfg.thresholds || {};
  const lat = summary?.latenciesMs || {};
  const errs = summary?.errors?.totals || {};
  const opTotal =
    Number(cfg.schedulerTicks || 0) +
    Number(cfg.receiptPosts || 0) +
    Number(cfg.txBuilderRequests || 0);
  const totalErrors =
    Number(errs.schedulerTick || 0) +
    Number(errs.receiptPost || 0) +
    Number(errs.txBuilder || 0);
  const errorRatePct = opTotal > 0 ? (totalErrors / opTotal) * 100 : 0;

  const checks = [
    ["schedulerTick.p95", Number(lat?.schedulerTick?.p95 || 0), Number(t.schedulerTickP95Ms || 0), "ms"],
    ["receiptPost.p95", Number(lat?.receiptPost?.p95 || 0), Number(t.receiptPostP95Ms || 0), "ms"],
    ["txBuilder.p95", Number(lat?.txBuilder?.p95 || 0), Number(t.txBuilderP95Ms || 0), "ms"],
  ];
  for (const [label, actual, max, unit] of checks) {
    if (max > 0 && actual > max) {
      out.push(`${label}=${actual}${unit} exceeds max ${max}${unit}`);
    }
  }
  if (Number(t.totalErrors || 0) >= 0 && totalErrors > Number(t.totalErrors || 0)) {
    out.push(`totalErrors=${totalErrors} exceeds max ${Number(t.totalErrors || 0)}`);
  }
  if (Number(t.errorRatePct || 0) > 0 && errorRatePct > Number(t.errorRatePct || 0)) {
    out.push(`errorRatePct=${errorRatePct.toFixed(2)} exceeds max ${Number(t.errorRatePct || 0).toFixed(2)}`);
  }
  const callbackP95 = Number(summary?.derivedMetrics?.scheduler?.callbackLatencyP95BucketMs || 0);
  if (Number(t.schedulerCallbackP95BucketMs || 0) > 0 && callbackP95 > Number(t.schedulerCallbackP95BucketMs || 0)) {
    out.push(`scheduler.callbackLatencyP95BucketMs=${callbackP95}ms exceeds max ${Number(t.schedulerCallbackP95BucketMs || 0)}ms`);
  }
  const saturationEvents = Number(summary?.derivedMetrics?.scheduler?.saturationEventsTotal || 0);
  if (Number(t.schedulerSaturationEvents || 0) > 0 && saturationEvents > Number(t.schedulerSaturationEvents || 0)) {
    out.push(`scheduler.saturationEventsTotal=${saturationEvents} exceeds max ${Number(t.schedulerSaturationEvents || 0)}`);
  }
  const callbackDuplicateEvents = Number(summary?.derivedMetrics?.callbackConsumer?.cycleDuplicateTotal || 0);
  if (Number.isFinite(Number(t.callbackDuplicateEvents)) && Number(t.callbackDuplicateEvents) >= 0 && callbackDuplicateEvents > Number(t.callbackDuplicateEvents)) {
    out.push(`callbackConsumer.cycleDuplicateTotal=${callbackDuplicateEvents} exceeds max ${Number(t.callbackDuplicateEvents)}`);
  }
  const callbackStaleFenceEvents = Number(summary?.derivedMetrics?.callbackConsumer?.cycleStaleFenceTotal || 0);
  if (Number.isFinite(Number(t.callbackStaleFenceEvents)) && Number(t.callbackStaleFenceEvents) >= 0 && callbackStaleFenceEvents > Number(t.callbackStaleFenceEvents)) {
    out.push(`callbackConsumer.cycleStaleFenceTotal=${callbackStaleFenceEvents} exceeds max ${Number(t.callbackStaleFenceEvents)}`);
  }
  return { failures: out, totalErrors, errorRatePct: Number(errorRatePct.toFixed(4)) };
}

function parsePromMetricValue(metricsText, metricName) {
  if (!metricsText) return null;
  const re = new RegExp(`^${metricName}\\s+(-?\\d+(?:\\.\\d+)?)$`, "m");
  const m = String(metricsText).match(re);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

function sumPromMetricValues(metricsTexts, metricName) {
  return (Array.isArray(metricsTexts) ? metricsTexts : [])
    .map((text) => Number(parsePromMetricValue(text, metricName) || 0))
    .reduce((a, b) => a + b, 0);
}

function maxHistogramP95Bucket(metricsTexts, metricBase) {
  let max = 0;
  let seen = false;
  for (const text of Array.isArray(metricsTexts) ? metricsTexts : []) {
    const v = Number(parseHistogramP95Bucket(text, metricBase) || 0);
    if (v > 0) {
      seen = true;
      if (v > max) max = v;
    }
  }
  return seen ? max : null;
}

function parseHistogramP95Bucket(metricsText, metricBase) {
  if (!metricsText) return null;
  const text = String(metricsText);
  const countMatch = text.match(new RegExp(`^${metricBase}_count\\s+(\\d+(?:\\.\\d+)?)$`, "m"));
  const totalCount = Number(countMatch?.[1] || 0);
  if (!(totalCount > 0)) return null;
  const target = totalCount * 0.95;
  const bucketRe = new RegExp(`^${metricBase}_bucket\\{[^}]*le="([^"]+)"[^}]*\\}\\s+(\\d+(?:\\.\\d+)?)$`, "gm");
  const buckets = [];
  let match;
  while ((match = bucketRe.exec(text)) !== null) {
    const leRaw = String(match[1] || "");
    const count = Number(match[2] || 0);
    if (!Number.isFinite(count)) continue;
    const le = leRaw === "+Inf" ? Number.POSITIVE_INFINITY : Number(leRaw);
    if (!Number.isFinite(le) && le !== Number.POSITIVE_INFINITY) continue;
    buckets.push({ le, count });
  }
  buckets.sort((a, b) => a.le - b.le);
  for (const bucket of buckets) {
    if (bucket.count >= target) {
      return Number.isFinite(bucket.le) ? bucket.le : null;
    }
  }
  return null;
}

async function runConcurrent(label, count, concurrency, fn) {
  const latencies = [];
  const errors = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, count) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= count) return;
      const started = nowMs();
      try {
        await fn(idx);
        latencies.push(nowMs() - started);
      } catch (e) {
        latencies.push(nowMs() - started);
        errors.push(String(e?.message || e || `${label}_error`));
      }
    }
  });
  await Promise.all(workers);
  return { latencies, errors };
}

function randomTxid(seed) {
  const hex = "0123456789abcdef";
  let out = "";
  let x = (seed * 2654435761) >>> 0;
  for (let i = 0; i < 64; i += 1) {
    x = (x ^ (x << 13) ^ (x >>> 17) ^ (x << 5)) >>> 0;
    out += hex[x % 16];
  }
  return out;
}

async function main() {
  const services = [];
  const servers = [];
  const startedAt = nowMs();
  try {
    const runId = `${startedAt}-${Math.floor(Math.random() * 1_000_000)}`;
    const schedulerRedisPrefix = cfg.schedulerRedisPrefix || `forgeos:load:scheduler:${runId}`;
    const callbackRedisPrefix = cfg.callbackRedisPrefix || `forgeos:load:callback:${runId}`;
    const schedulerInstances = Math.max(1, Number(cfg.schedulerInstances || 1));
    if (schedulerInstances > 1 && !cfg.schedulerRedisUrl) {
      console.warn("[load-pipeline] warning: LOAD_PIPELINE_SCHEDULER_INSTANCES>1 without Redis; leader/fencing behavior will not be exercised.");
    }
    const kasApiPort = await getFreePort();
    const callbackPort = await getFreePort();
    const schedulerPorts = [];
    for (let i = 0; i < schedulerInstances; i += 1) schedulerPorts.push(await getFreePort());
    const txBuilderPort = await getFreePort();
    const txBuilderUpstreamPort = cfg.txBuilderMode === "command-mock" ? await getFreePort() : 0;

    const kasApi = await startJsonServer(kasApiPort, async (req, _body, url) => {
      if (req.method === "GET" && url.pathname === "/info/price") return { body: { price: 0.12 } };
      if (req.method === "GET" && url.pathname === "/info/blockdag") {
        return { body: { networkName: "kaspa-mainnet", headerCount: 1000, blockCount: 1000, daaScore: 1000 } };
      }
      if (req.method === "GET" && /\/addresses\/.+\/balance$/.test(url.pathname)) {
        return { body: { balance: 100000000000 } };
      }
      if (req.method === "GET" && url.pathname === `/addresses/${encodeURIComponent(SOURCE_ADDRESS)}/utxos`) {
        return {
          body: [
            {
              address: SOURCE_ADDRESS,
              outpoint: {
                transactionId: "e7853df278ddbd2b9ec567ea9ea17722e70ef8df284425d8a44d4f0e998757de",
                index: 0,
              },
              utxoEntry: {
                amount: "1999997931",
                scriptPublicKey: {
                  scriptPublicKey: "202c0b0a4c1f84e31b7234adb319ae970b6943592f0eae5e8513fcc476d0d211a5ac",
                },
                blockDaaScore: "33922603",
                isCoinbase: false,
              },
            },
          ],
        };
      }
      return { status: 404, body: { error: "not_found" } };
    });
    servers.push(kasApi);

    let txBuilderUpstream = null;
    if (cfg.txBuilderMode === "command-mock") {
      txBuilderUpstream = await startJsonServer(txBuilderUpstreamPort, async (_req, body, url) => {
        if (url.pathname !== "/v1/build") return { status: 404, body: { error: "not_found" } };
        return {
          body: {
            txJson: JSON.stringify({
              mock: true,
              wallet: body?.wallet || "kastle",
              outputs: Array.isArray(body?.outputs) ? body.outputs.length : 0,
              ts: nowMs(),
            }),
          },
        };
      });
      servers.push(txBuilderUpstream);
    }

    const callbackConsumer = spawnNode(["server/callback-consumer/index.mjs"], {
      PORT: String(callbackPort),
      HOST,
      ...(cfg.callbackRedisUrl ? { CALLBACK_CONSUMER_REDIS_URL: cfg.callbackRedisUrl } : {}),
      ...(cfg.callbackRedisUrl ? { CALLBACK_CONSUMER_REDIS_PREFIX: callbackRedisPrefix } : {}),
    });
    services.push(callbackConsumer);
    await waitForHttp(`http://${HOST}:${callbackPort}/health`);

    const schedulers = [];
    for (let i = 0; i < schedulerPorts.length; i += 1) {
      const scheduler = spawnNode(["server/scheduler/index.mjs"], {
        PORT: String(schedulerPorts[i]),
        HOST,
        KAS_API_BASE: `http://${HOST}:${kasApiPort}`,
        SCHEDULER_TICK_MS: "60000",
        SCHEDULER_REDIS_AUTHORITATIVE_QUEUE: cfg.schedulerRedisUrl ? "true" : "false",
        SCHEDULER_CALLBACK_TIMEOUT_MS: "2500",
        SCHEDULER_INSTANCE_ID: `load-scheduler-${i + 1}`,
        ...(cfg.schedulerRedisUrl ? { SCHEDULER_REDIS_URL: cfg.schedulerRedisUrl } : {}),
        ...(cfg.schedulerRedisUrl ? { SCHEDULER_REDIS_PREFIX: schedulerRedisPrefix } : {}),
      });
      schedulers.push(scheduler);
      services.push(scheduler);
    }
    await Promise.all(schedulerPorts.map((port) => waitForHttp(`http://${HOST}:${port}/health`)));

    const txBuilderEnv =
      cfg.txBuilderMode === "command-mock"
        ? {
            PORT: String(txBuilderPort),
            HOST,
            TX_BUILDER_COMMAND: "node server/tx-builder/commands/kastle-http-bridge-command.mjs",
            KASTLE_TX_BUILDER_COMMAND_UPSTREAM_URL: `http://${HOST}:${txBuilderUpstreamPort}/v1/build`,
          }
        : {
            PORT: String(txBuilderPort),
            HOST,
            TX_BUILDER_LOCAL_WASM_ENABLED: "true",
            TX_BUILDER_KAS_API_MAINNET: `http://${HOST}:${kasApiPort}`,
          };

    const txBuilder = spawnNode(["server/tx-builder/index.mjs"], txBuilderEnv);
    services.push(txBuilder);
    await waitForHttp(`http://${HOST}:${txBuilderPort}/health`);

    for (let i = 0; i < cfg.agents; i += 1) {
      const reg = await httpJson(`http://${HOST}:${schedulerPorts[0]}/v1/agents/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "load-user",
          id: `agent-${i}`,
          walletAddress: TREASURY_ADDRESS,
          callbackUrl: `http://${HOST}:${callbackPort}/v1/scheduler/cycle`,
          cycleIntervalMs: 1000,
        }),
      });
      if (!reg.res.ok) throw new Error(`register_failed_${i}:${reg.text}`);
    }

    await new Promise((r) => setTimeout(r, 1200));

    const [tickRun, receiptRun, txBuildRun] = await Promise.all([
      runConcurrent("scheduler_tick", cfg.schedulerTicks, Math.min(4, cfg.concurrency), async () => {
        const port = schedulerPorts.length > 0 ? schedulerPorts[Math.floor(Math.random() * schedulerPorts.length)] : schedulerPorts[0];
        const out = await httpJson(`http://${HOST}:${port}/v1/scheduler/tick`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!out.res.ok) throw new Error(`tick_${out.res.status}`);
      }),
      runConcurrent("receipt_post", cfg.receiptPosts, cfg.concurrency, async (i) => {
        const txid = randomTxid(i + 1);
        const out = await httpJson(`http://${HOST}:${callbackPort}/v1/execution-receipts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            txid,
            userId: "load-user",
            agentId: `agent-${i % Math.max(1, cfg.agents)}`,
            status: "confirmed",
            confirmations: 1 + (i % 4),
            feeKas: 0.0001,
            broadcastTs: nowMs() - 1500,
            confirmTs: nowMs(),
            confirmTsSource: "chain",
            priceAtBroadcastUsd: 0.12,
            priceAtConfirmUsd: 0.121 + (i % 5) * 0.0001,
            slippageKas: 0.001 + (i % 3) * 0.0001,
          }),
        });
        if (!out.res.ok) throw new Error(`receipt_${out.res.status}`);
      }),
      runConcurrent("tx_builder", cfg.txBuilderRequests, cfg.concurrency, async (i) => {
        const out = await httpJson(`http://${HOST}:${txBuilderPort}/v1/kastle/build-tx-json`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            wallet: "kastle",
            networkId: "mainnet",
            fromAddress: SOURCE_ADDRESS,
            outputs: [
              { address: SOURCE_ADDRESS, amountKas: 1.0 },
              { address: TREASURY_ADDRESS, amountKas: 0.06 + (i % 5) * 0.001 },
            ],
            purpose: "load-test-combined-treasury",
          }),
        });
        if (!out.res.ok) throw new Error(`tx_builder_${out.res.status}`);
      }),
    ]);

    await new Promise((r) => setTimeout(r, 1000));

    const [schedulerMetricsList, callbackMetrics, txBuilderMetrics] = await Promise.all([
      Promise.all(schedulerPorts.map((port) => fetch(`http://${HOST}:${port}/metrics`).then((r) => r.text()))),
      fetch(`http://${HOST}:${callbackPort}/metrics`).then((r) => r.text()),
      fetch(`http://${HOST}:${txBuilderPort}/metrics`).then((r) => r.text()),
    ]);
    const schedulerMetricsJoined = schedulerMetricsList
      .map((text, idx) => `# scheduler[${idx + 1}] port=${schedulerPorts[idx]}\n${String(text || "").trim()}`)
      .join("\n\n");
    const schedulerCallbackLatencyP95BucketMs = maxHistogramP95Bucket(
      schedulerMetricsList,
      "forgeos_scheduler_callback_latency_ms"
    );
    const schedulerSaturationEventsTotal = sumPromMetricValues(
      schedulerMetricsList,
      "forgeos_scheduler_saturation_events_total"
    );
    const schedulerLeaderActiveCount = sumPromMetricValues(
      schedulerMetricsList,
      "forgeos_scheduler_leader_active"
    );
    const callbackCycleDuplicateTotal = Number(parsePromMetricValue(
      callbackMetrics,
      "forgeos_callback_consumer_cycle_duplicate_total"
    ) || 0);
    const callbackCycleStaleFenceTotal = Number(parsePromMetricValue(
      callbackMetrics,
      "forgeos_callback_consumer_cycle_stale_fence_total"
    ) || 0);

    const summary = {
      config: cfg,
      durationMs: nowMs() - startedAt,
      latenciesMs: {
        schedulerTick: stats(tickRun.latencies),
        receiptPost: stats(receiptRun.latencies),
        txBuilder: stats(txBuildRun.latencies),
      },
      errors: {
        schedulerTick: tickRun.errors.slice(0, 10),
        receiptPost: receiptRun.errors.slice(0, 10),
        txBuilder: txBuildRun.errors.slice(0, 10),
        totals: {
          schedulerTick: tickRun.errors.length,
          receiptPost: receiptRun.errors.length,
          txBuilder: txBuildRun.errors.length,
        },
      },
      derivedMetrics: {
        scheduler: {
          instances: schedulerPorts.length,
          callbackLatencyP95BucketMs: schedulerCallbackLatencyP95BucketMs,
          saturationEventsTotal: schedulerSaturationEventsTotal,
          leaderActiveCount: schedulerLeaderActiveCount,
        },
        callbackConsumer: {
          cycleDuplicateTotal: callbackCycleDuplicateTotal,
          cycleStaleFenceTotal: callbackCycleStaleFenceTotal,
        },
      },
      metrics: {
        scheduler: schedulerMetricsJoined,
        schedulers: schedulerMetricsList,
        callbackConsumer: callbackMetrics,
        txBuilder: txBuilderMetrics,
      },
    };

    console.log("=== ForgeOS Pipeline Load Summary ===");
    console.log(JSON.stringify({
      config: summary.config,
      durationMs: summary.durationMs,
      latenciesMs: summary.latenciesMs,
      errors: summary.errors,
      derivedMetrics: summary.derivedMetrics,
    }, null, 2));
    console.log("\n=== Scheduler Metrics ===\n" + schedulerMetricsJoined.trim());
    console.log("\n=== Callback Consumer Metrics ===\n" + callbackMetrics.trim());
    console.log("\n=== Tx Builder Metrics ===\n" + txBuilderMetrics.trim());

    const threshold = thresholdFailures(summary);
    if (threshold.failures.length > 0) {
      console.error("\n[load-pipeline] threshold failures:");
      for (const line of threshold.failures) console.error(`- ${line}`);
      process.exitCode = 1;
    } else if (threshold.totalErrors > 0) {
      process.exitCode = 1;
    }
  } finally {
    await Promise.all(services.map((svc) => stopProc(svc)));
    await Promise.all(servers.map((server) => new Promise((resolve) => {
      try { server.close(() => resolve()); } catch { resolve(); }
    })));
  }
}

main().catch((e) => {
  console.error("[load-pipeline] fatal:", e);
  process.exit(1);
});
