#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const CONTROL_HOST = String(process.env.LOCAL_NODE_CONTROL_HOST || "127.0.0.1").trim() || "127.0.0.1";
const CONTROL_PORT = Number(process.env.LOCAL_NODE_CONTROL_PORT || 19725);
const CONTROL_BASE = `http://${CONTROL_HOST}:${CONTROL_PORT}`;
const PROFILE = String(process.env.LOCAL_NODE_DEFAULT_PROFILE || "mainnet").trim() || "mainnet";
const HEALTH_TIMEOUT_MS = 1_500;
const STARTUP_WAIT_MS = Number(process.env.LOCAL_NODE_DOCTOR_STARTUP_WAIT_MS || 20_000);
const RPC_HEALTH_WAIT_MS = Number(process.env.LOCAL_NODE_DOCTOR_RPC_HEALTH_WAIT_MS || 45_000);
const POLL_MS = 1_000;

function log(line) {
  process.stdout.write(`[doctor] ${line}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function platformTag() {
  return `${String(process.platform).toUpperCase()}_${String(process.arch).toUpperCase()}`;
}

function isLikelyPlaceholder(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return false;
  return v.includes("<") || v.includes(">") || v.includes("your-artifact-url") || v.includes("example");
}

function isValidHttpUrl(value) {
  try {
    const u = new URL(String(value || "").trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function whichKaspad() {
  if (process.platform === "win32") {
    const out = spawnSync("where", ["kaspad"], { encoding: "utf8" });
    if (out.status === 0 && out.stdout.trim()) return out.stdout.trim().split(/\r?\n/)[0]?.trim() || "";
    return "";
  }
  const out = spawnSync("which", ["kaspad"], { encoding: "utf8" });
  if (out.status === 0 && out.stdout.trim()) return out.stdout.trim();
  return "";
}

function preflightBinary() {
  const explicit = String(process.env.LOCAL_NODE_KASPAD_BINARY || "").trim();
  if (explicit) {
    try {
      fs.accessSync(explicit, fs.constants.X_OK);
      return { ok: true, mode: "explicit", detail: explicit };
    } catch {
      return { ok: false, mode: "explicit", detail: `${explicit} (not executable or not found)` };
    }
  }

  const fromPath = whichKaspad();
  if (fromPath) return { ok: true, mode: "path", detail: fromPath };

  const tag = platformTag();
  const url = String(process.env[`LOCAL_NODE_KASPAD_URL_${tag}`] || "").trim();
  const sha = String(process.env[`LOCAL_NODE_KASPAD_SHA256_${tag}`] || "").trim();
  if (url || sha) {
    if (!url || !sha) {
      return {
        ok: false,
        mode: "missing",
        detail: `incomplete artifact config for ${tag}; set both LOCAL_NODE_KASPAD_URL_${tag} and LOCAL_NODE_KASPAD_SHA256_${tag}`,
      };
    }
    if (isLikelyPlaceholder(url) || !isValidHttpUrl(url)) {
      return {
        ok: false,
        mode: "missing",
        detail: `artifact URL for ${tag} is placeholder/invalid: ${url}`,
      };
    }
    return { ok: true, mode: "download", detail: `${tag} artifact configured` };
  }
  return {
    ok: false,
    mode: "missing",
    detail: `no LOCAL_NODE_KASPAD_BINARY, no kaspad in PATH, and missing LOCAL_NODE_KASPAD_URL_${tag}/SHA256`,
  };
}

async function fetchJson(pathname, options = {}, timeoutMs = HEALTH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${CONTROL_BASE}${pathname}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: { error: error instanceof Error ? error.message : String(error) },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForControlReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const health = await fetchJson("/health");
    if (health.ok && health.data?.ok) return true;
    await sleep(300);
  }
  return false;
}

async function waitForRpcHealthy(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const statusRes = await fetchJson("/node/status", {}, 2_500);
    const status = statusRes.data?.status;
    if (statusRes.ok && status?.running && status?.rpcHealthy) {
      return statusRes.data;
    }
    await sleep(POLL_MS);
  }
  return null;
}

async function main() {
  const preflight = preflightBinary();
  log(`platform tag: ${platformTag()}`);
  if (preflight.ok) {
    log(`binary preflight: OK (${preflight.mode}) ${preflight.detail}`);
  } else {
    log(`binary preflight: MISSING (${preflight.detail})`);
  }

  let spawnedService = null;
  let initialStatus = null;

  const initialHealth = await fetchJson("/health");
  const serviceWasRunning = Boolean(initialHealth.ok && initialHealth.data?.ok);
  if (!serviceWasRunning) {
    log("control service not reachable; starting temporary local-node service");
    spawnedService = spawn(process.execPath, [path.join("server", "local-node", "index.mjs")], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
      env: process.env,
    });
    spawnedService.stdout?.on("data", (chunk) => {
      const text = String(chunk || "").trim();
      if (text) log(`service: ${text}`);
    });
    spawnedService.stderr?.on("data", (chunk) => {
      const text = String(chunk || "").trim();
      if (text) log(`service: ${text}`);
    });
    const ready = await waitForControlReady(STARTUP_WAIT_MS);
    if (!ready) {
      throw new Error(`control service failed to start within ${STARTUP_WAIT_MS}ms`);
    }
  } else {
    log("control service reachable");
  }

  try {
    const statusRes = await fetchJson("/node/status");
    if (!statusRes.ok) {
      throw new Error(`failed reading /node/status: ${statusRes.data?.error || statusRes.status}`);
    }
    initialStatus = statusRes.data?.status || null;
    const initiallyRunning = Boolean(initialStatus?.running);
    log(`initial node status: running=${initiallyRunning} rpcHealthy=${Boolean(initialStatus?.rpcHealthy)} profile=${initialStatus?.networkProfile || "unknown"}`);

    if (!preflight.ok && !initiallyRunning) {
      throw new Error(`preflight failed: ${preflight.detail}`);
    }

    if (initiallyRunning) {
      const healthy = await waitForRpcHealthy(RPC_HEALTH_WAIT_MS);
      if (!healthy) {
        throw new Error(`node was already running but rpcHealthy did not become true within ${RPC_HEALTH_WAIT_MS}ms`);
      }
      log("node already running and RPC healthy");
      log("doctor result: PASS");
      return;
    }

    log(`starting node with profile=${PROFILE}`);
    const startRes = await fetchJson("/node/start", {
      method: "POST",
      body: JSON.stringify({ networkProfile: PROFILE }),
    }, Math.max(10_000, STARTUP_WAIT_MS));
    if (!startRes.ok) {
      throw new Error(`start failed: ${startRes.data?.error || startRes.status}`);
    }
    log("start request accepted; waiting for RPC healthy");
    const healthy = await waitForRpcHealthy(RPC_HEALTH_WAIT_MS);
    if (!healthy) {
      throw new Error(`node did not reach rpcHealthy=true within ${RPC_HEALTH_WAIT_MS}ms`);
    }
    const finalStatus = healthy?.status;
    log(`rpc healthy: connectionState=${finalStatus?.connectionState || "unknown"} synced=${Boolean(finalStatus?.sync?.synced)} progress=${finalStatus?.sync?.progressPct ?? "n/a"}%`);

    log("stopping node after verification");
    const stopRes = await fetchJson("/node/stop", { method: "POST", body: JSON.stringify({}) }, 12_000);
    if (!stopRes.ok) {
      throw new Error(`stop failed: ${stopRes.data?.error || stopRes.status}`);
    }
    log("doctor result: PASS");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log(`doctor result: FAIL (${msg})`);
    process.exitCode = 1;
  } finally {
    if (spawnedService && !spawnedService.killed) {
      spawnedService.kill("SIGTERM");
      await sleep(250);
      if (!spawnedService.killed) {
        try { spawnedService.kill("SIGKILL"); } catch {}
      }
    }
  }
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  log(`doctor fatal: ${msg}`);
  process.exit(1);
});
