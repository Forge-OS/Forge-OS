import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { buildKaspadArgs, normalizeNetworkProfile, LOCAL_NODE_PROFILES } from "./networkProfiles.mjs";

const DEFAULT_CONTROL_PORT = 19725;
const DEFAULT_BACKOFF_BASE_MS = 1_000;
const DEFAULT_BACKOFF_MAX_MS = 30_000;
const DEFAULT_RPC_PROBE_TIMEOUT_MS = 1_500;
const DEFAULT_SYNC_CACHE_TTL_MS = 1_500;
const DEFAULT_RPC_STARTUP_WAIT_MS = 8_000;
const DEFAULT_RPC_STARTUP_PROBE_INTERVAL_MS = 750;
const DEFAULT_LOG_TAIL_MAX_BYTES = 256 * 1024;

/**
 * @typedef NodeManagerStatus
 * @property {boolean} running
 * @property {number|null} pid
 * @property {string} networkProfile
 * @property {string|null} dataDir
 * @property {string|null} rpcBaseUrl
 * @property {boolean} rpcHealthy
 * @property {"stopped"|"connecting"|"healthy"|"syncing"|"degraded"} connectionState
 * @property {number} restartCount
 * @property {number} backoffMs
 * @property {number|null} lastStartAt
 * @property {number|null} lastExitAt
 * @property {number|null} lastExitCode
 * @property {string|null} error
 * @property {import("./nodeManager.mjs").SyncSnapshot|null} sync
 */

/**
 * @typedef SyncSnapshot
 * @property {boolean} synced
 * @property {number|null} progressPct
 * @property {number|null} blockCount
 * @property {number|null} headerCount
 * @property {string} source
 * @property {number} updatedAt
 */

function nowMs() {
  return Date.now();
}

function normalizeDataDir(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return "";
  if (trimmed.startsWith("~")) return path.join(os.homedir(), trimmed.slice(1));
  return trimmed;
}

/**
 * Resolve ForgeOS-managed local node data root using OS-native conventions.
 * @param {object} [input]
 * @param {string} [input.platform]
 * @param {NodeJS.ProcessEnv} [input.env]
 * @param {string} [input.homeDir]
 * @returns {string}
 */
export function resolveDefaultNodeBaseDir(input = {}) {
  const platform = String(input.platform || process.platform);
  const env = input.env || process.env;
  const homeDir = String(input.homeDir || os.homedir());

  if (platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support", "ForgeOS", "local-node");
  }
  if (platform === "win32") {
    const localAppData = String(env.LOCALAPPDATA || "").trim()
      || path.join(homeDir, "AppData", "Local");
    return path.join(localAppData, "ForgeOS", "local-node");
  }
  const xdgDataHome = String(env.XDG_DATA_HOME || "").trim();
  if (xdgDataHome) {
    return path.join(xdgDataHome, "forgeos", "local-node");
  }
  return path.join(homeDir, ".local", "share", "forgeos", "local-node");
}

function platformTag(platform, arch) {
  return `${String(platform || process.platform).toUpperCase()}_${String(arch || process.arch).toUpperCase()}`;
}

function defaultState() {
  return {
    running: false,
    pid: null,
    networkProfile: "mainnet",
    dataDir: null,
    rpcBaseUrl: null,
    rpcHealthy: false,
    connectionState: "stopped",
    restartCount: 0,
    backoffMs: 0,
    lastStartAt: null,
    lastExitAt: null,
    lastExitCode: null,
    error: null,
    sync: null,
  };
}

export class NodeManager {
  /**
   * @param {object} [options]
   * @param {string} [options.binaryPath]
   * @param {string} [options.baseDataDir]
   * @param {string} [options.controlHost]
   * @param {number} [options.controlPort]
   * @param {string} [options.rpcBaseUrl]
   * @param {number} [options.restartBackoffBaseMs]
   * @param {number} [options.restartBackoffMaxMs]
   * @param {boolean} [options.autoInstall]
   * @param {object} [deps]
   */
  constructor(options = {}, deps = {}) {
    this.options = {
      binaryPath: options.binaryPath || "",
      baseDataDir:
        normalizeDataDir(options.baseDataDir)
        || resolveDefaultNodeBaseDir({
          platform: deps.processPlatform || process.platform,
          env: process.env,
          homeDir: os.homedir(),
        }),
      controlHost: options.controlHost || "127.0.0.1",
      controlPort: Number(options.controlPort || DEFAULT_CONTROL_PORT),
      rpcHost: String(options.rpcHost || process.env.LOCAL_NODE_RPC_HOST || "127.0.0.1").trim() || "127.0.0.1",
      rpcBaseUrl: String(options.rpcBaseUrl || process.env.LOCAL_NODE_RPC_BASE_URL || "").trim(),
      restartBackoffBaseMs: Number(options.restartBackoffBaseMs || process.env.LOCAL_NODE_RESTART_BACKOFF_BASE_MS || DEFAULT_BACKOFF_BASE_MS),
      restartBackoffMaxMs: Number(options.restartBackoffMaxMs || process.env.LOCAL_NODE_RESTART_BACKOFF_MAX_MS || DEFAULT_BACKOFF_MAX_MS),
      rpcProbeTimeoutMs: Number(options.rpcProbeTimeoutMs || process.env.LOCAL_NODE_RPC_PROBE_TIMEOUT_MS || DEFAULT_RPC_PROBE_TIMEOUT_MS),
      syncCacheTtlMs: Number(options.syncCacheTtlMs || process.env.LOCAL_NODE_SYNC_CACHE_TTL_MS || DEFAULT_SYNC_CACHE_TTL_MS),
      rpcStartupWaitMs: Number(options.rpcStartupWaitMs || process.env.LOCAL_NODE_RPC_STARTUP_WAIT_MS || DEFAULT_RPC_STARTUP_WAIT_MS),
      rpcStartupProbeIntervalMs: Number(options.rpcStartupProbeIntervalMs || process.env.LOCAL_NODE_RPC_STARTUP_PROBE_INTERVAL_MS || DEFAULT_RPC_STARTUP_PROBE_INTERVAL_MS),
      logTailMaxBytes: Number(options.logTailMaxBytes || process.env.LOCAL_NODE_LOG_TAIL_MAX_BYTES || DEFAULT_LOG_TAIL_MAX_BYTES),
      autoInstall: options.autoInstall !== false,
    };
    this.deps = {
      fs: deps.fs || fs,
      fsp: deps.fsp || fsp,
      spawn: deps.spawn || spawn,
      spawnSync: deps.spawnSync || spawnSync,
      fetch: deps.fetch || fetch,
      setTimeout: deps.setTimeout || setTimeout,
      clearTimeout: deps.clearTimeout || clearTimeout,
      processPlatform: deps.processPlatform || process.platform,
      processArch: deps.processArch || process.arch,
    };
    this.child = null;
    this.binaryPath = this.options.binaryPath || "";
    this.logFilePath = "";
    this.desiredRunning = false;
    this.restartTimer = null;
    this.restartAttempt = 0;
    this.state = defaultState();
    this.syncProbeInFlight = null;
    this.syncProbeCache = null;
  }

  async start(params = {}) {
    const profile = normalizeNetworkProfile(params.networkProfile || this.state.networkProfile || "mainnet");
    const baseDataDir = normalizeDataDir(params.dataDir || this.options.baseDataDir);
    const profileDataDir = path.join(baseDataDir, profile);
    const logDir = path.join(profileDataDir, "logs");
    const logFilePath = path.join(logDir, "kaspad.log");

    await this.deps.fsp.mkdir(logDir, { recursive: true });

    if (this.state.running && this.child && !this.child.killed) {
      const sameProfile = normalizeNetworkProfile(this.state.networkProfile) === profile;
      const currentDataDir = this.state.dataDir ? path.resolve(this.state.dataDir) : "";
      const nextDataDir = path.resolve(profileDataDir);
      if (!sameProfile || currentDataDir !== nextDataDir) {
        await this.stop();
      } else {
        this.state.networkProfile = profile;
        this.state.dataDir = profileDataDir;
        this.logFilePath = logFilePath;
        return this.status();
      }
    }

    const spec = LOCAL_NODE_PROFILES[profile];
    const rpcHost = String(params.rpcHost || this.options.rpcHost || "127.0.0.1").trim() || "127.0.0.1";
    const rpcPort = Number(params.rpcPort || spec.defaultRpcPort) || spec.defaultRpcPort;
    const rpcBaseUrl = this.options.rpcBaseUrl
      ? this.options.rpcBaseUrl
      : `http://${rpcHost}:${rpcPort}`;

    this.desiredRunning = true;
    this.state.networkProfile = profile;
    this.state.dataDir = profileDataDir;
    this.logFilePath = logFilePath;
    this.state.rpcBaseUrl = rpcBaseUrl;
    this.state.error = null;
    this.state.connectionState = "connecting";

    const binaryPath = await this.locateOrInstallBinary();
    this.binaryPath = binaryPath;
    const args = buildKaspadArgs({
      profile,
      profileDataDir,
      logDir,
      rpcHost,
      rpcPort,
      p2pHost: "0.0.0.0",
      p2pPort: spec.defaultP2pPort,
      extraArgs: parseExtraArgs(profile),
    });

    const child = this.deps.spawn(binaryPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    this.state.running = true;
    this.state.pid = child?.pid ?? null;
    this.state.lastStartAt = nowMs();
    this.state.error = null;
    this.restartAttempt = 0;
    this.state.backoffMs = 0;

    const appendLog = async (chunk, streamName) => {
      const line = `[${new Date().toISOString()}][${streamName}] ${String(chunk)}`;
      await this.deps.fsp.appendFile(this.logFilePath, line, "utf8").catch(() => {});
    };

    child?.stdout?.on("data", (chunk) => {
      void appendLog(chunk, "stdout");
    });
    child?.stderr?.on("data", (chunk) => {
      void appendLog(chunk, "stderr");
    });

    child?.on("error", (error) => {
      this.state.error = error instanceof Error ? error.message : String(error);
      this.state.running = false;
      this.state.pid = null;
      this.state.lastExitAt = nowMs();
      this.state.lastExitCode = null;
      this.state.connectionState = "degraded";
      this.scheduleRestart();
    });

    child?.on("exit", (code) => {
      this.state.running = false;
      this.state.pid = null;
      this.state.lastExitAt = nowMs();
      this.state.lastExitCode = typeof code === "number" ? code : null;
      this.state.connectionState = "degraded";
      this.scheduleRestart();
    });

    await this.waitForRpcReady();
    return this.status();
  }

  async stop() {
    this.desiredRunning = false;
    if (this.restartTimer) {
      this.deps.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const child = this.child;
    if (!child || child.killed) {
      this.state.running = false;
      this.state.pid = null;
      this.state.connectionState = "stopped";
      return this.status();
    }

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      child.once("exit", finish);
      try {
        child.kill("SIGTERM");
      } catch {
        finish();
      }
      this.deps.setTimeout(() => {
        if (!settled) {
          try { child.kill("SIGKILL"); } catch {}
          finish();
        }
      }, 4_000);
    });

    this.state.running = false;
    this.state.pid = null;
    this.child = null;
    this.state.connectionState = "stopped";
    this.syncProbeCache = null;
    return this.status();
  }

  async restart(params = {}) {
    await this.stop();
    return this.start(params);
  }

  status() {
    return {
      ...this.state,
      networkProfile: normalizeNetworkProfile(this.state.networkProfile),
      dataDir: this.state.dataDir,
      rpcBaseUrl: this.state.rpcBaseUrl,
      logFilePath: this.logFilePath || null,
      binaryPath: this.binaryPath || null,
    };
  }

  async getLogsTail(lines = 80) {
    const safeLines = Math.min(500, Math.max(1, Math.floor(lines)));
    if (!this.logFilePath) return "";
    try {
      const content = await readTailUtf8(this.deps.fsp, this.logFilePath, this.options.logTailMaxBytes);
      const rows = content.split(/\r?\n/);
      return rows.slice(-safeLines).join("\n").trim();
    } catch {
      return "";
    }
  }

  async isSynced() {
    const sync = await this.refreshSync({ force: true });
    return Boolean(sync?.synced);
  }

  async getSyncProgress() {
    const sync = await this.refreshSync({ force: true });
    return sync;
  }

  async refreshSync(options = {}) {
    const force = options.force === true;
    const ttlMs = Math.max(250, Number(this.options.syncCacheTtlMs || DEFAULT_SYNC_CACHE_TTL_MS));
    const now = nowMs();
    if (!force && this.syncProbeCache && this.syncProbeCache.expiresAt > now) {
      return this.syncProbeCache.snapshot;
    }
    if (!force && this.syncProbeInFlight) {
      return this.syncProbeInFlight;
    }

    this.syncProbeInFlight = this.#performSyncProbe();
    const snapshot = await this.syncProbeInFlight;
    this.syncProbeInFlight = null;
    this.syncProbeCache = {
      snapshot,
      expiresAt: nowMs() + ttlMs,
    };
    return snapshot;
  }

  async #performSyncProbe() {
    const rpcBaseUrl = this.state.rpcBaseUrl || this.options.rpcBaseUrl;
    if (!rpcBaseUrl) {
      this.state.rpcHealthy = false;
      this.state.sync = null;
      this.state.connectionState = this.state.running ? "degraded" : "stopped";
      return null;
    }
    try {
      const response = await fetchWithTimeout(this.deps.fetch, `${rpcBaseUrl.replace(/\/+$/, "")}/info/blockdag`, this.options.rpcProbeTimeoutMs);
      if (!response.ok) throw new Error(`RPC health ${response.status}`);
      const payload = await response.json().catch(() => ({}));
      const blockCount = Number(payload?.blockCount);
      const headerCount = Number(payload?.headerCount);
      const explicitSynced = payload?.isSynced;
      const progressPct = Number.isFinite(blockCount) && Number.isFinite(headerCount) && headerCount > 0
        ? Math.max(0, Math.min(100, (blockCount / headerCount) * 100))
        : null;
      const synced = typeof explicitSynced === "boolean"
        ? explicitSynced
        : (progressPct != null ? progressPct >= 99.5 : false);
      /** @type {SyncSnapshot} */
      const snapshot = {
        synced,
        progressPct,
        blockCount: Number.isFinite(blockCount) ? blockCount : null,
        headerCount: Number.isFinite(headerCount) ? headerCount : null,
        source: "local_rpc_probe",
        updatedAt: nowMs(),
      };
      this.state.rpcHealthy = true;
      this.state.connectionState = synced ? "healthy" : "syncing";
      this.state.sync = snapshot;
      return snapshot;
    } catch (error) {
      this.state.rpcHealthy = false;
      this.state.sync = {
        synced: false,
        progressPct: null,
        blockCount: null,
        headerCount: null,
        source: "local_rpc_probe",
        updatedAt: nowMs(),
      };
      const startupWindow = Math.max(1_000, Number(this.options.rpcStartupWaitMs || DEFAULT_RPC_STARTUP_WAIT_MS));
      const stillStarting = Boolean(
        this.state.running
        && this.state.lastStartAt
        && (nowMs() - this.state.lastStartAt) < startupWindow,
      );
      this.state.connectionState = this.state.running
        ? (stillStarting ? "connecting" : "degraded")
        : "stopped";
      this.state.error = error instanceof Error ? error.message : String(error);
      return this.state.sync;
    }
  }

  async waitForRpcReady() {
    const maxWaitMs = Math.max(1_000, Number(this.options.rpcStartupWaitMs || DEFAULT_RPC_STARTUP_WAIT_MS));
    const intervalMs = Math.max(200, Number(this.options.rpcStartupProbeIntervalMs || DEFAULT_RPC_STARTUP_PROBE_INTERVAL_MS));
    const deadline = nowMs() + maxWaitMs;

    while (nowMs() < deadline) {
      const snapshot = await this.refreshSync({ force: true });
      if (this.state.rpcHealthy && snapshot) return snapshot;
      if (!this.state.running || (this.child && this.child.killed)) break;
      await sleep(this.deps.setTimeout, intervalMs);
    }
    return this.state.sync;
  }

  scheduleRestart() {
    if (!this.desiredRunning) return;
    if (this.restartTimer) return;
    const backoffBase = Math.max(100, this.options.restartBackoffBaseMs || DEFAULT_BACKOFF_BASE_MS);
    const backoffMax = Math.max(backoffBase, this.options.restartBackoffMaxMs || DEFAULT_BACKOFF_MAX_MS);
    const delay = Math.min(backoffMax, backoffBase * (2 ** this.restartAttempt));
    this.restartAttempt += 1;
    this.state.restartCount += 1;
    this.state.backoffMs = delay;
    this.restartTimer = this.deps.setTimeout(async () => {
      this.restartTimer = null;
      if (!this.desiredRunning) return;
      try {
        await this.start({
          networkProfile: this.state.networkProfile,
          dataDir: this.state.dataDir,
        });
      } catch (error) {
        this.state.error = error instanceof Error ? error.message : String(error);
        this.state.connectionState = "degraded";
        this.scheduleRestart();
      }
    }, delay);
  }

  async locateOrInstallBinary() {
    if (this.binaryPath && await fileExists(this.deps.fsp, this.deps.fs, this.binaryPath)) {
      return this.binaryPath;
    }

    const fromPath = this.findBinaryOnPath();
    if (fromPath) return fromPath;

    const platform = this.deps.processPlatform;
    const cachedBinary = path.join(
      this.options.baseDataDir,
      "bin",
      platform === "win32" ? "kaspad.exe" : "kaspad",
    );
    if (await fileExists(this.deps.fsp, this.deps.fs, cachedBinary)) {
      return cachedBinary;
    }

    if (!this.options.autoInstall) {
      throw new Error("kaspad binary not found (auto-install disabled)");
    }

    return this.installBinary(cachedBinary);
  }

  findBinaryOnPath() {
    const platform = this.deps.processPlatform;
    const binaryNames = platform === "win32" ? ["kaspad.exe", "kaspad"] : ["kaspad"];
    const pathList = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
    for (const directory of pathList) {
      for (const binaryName of binaryNames) {
        const full = path.join(directory, binaryName);
        try {
          this.deps.fs.accessSync(full, this.deps.fs.constants.X_OK);
          return full;
        } catch {
          // keep scanning
        }
      }
    }
    return "";
  }

  async installBinary(targetBinaryPath) {
    const tag = platformTag(this.deps.processPlatform, this.deps.processArch);
    const url = String(process.env[`LOCAL_NODE_KASPAD_URL_${tag}`] || "").trim();
    const checksum = String(process.env[`LOCAL_NODE_KASPAD_SHA256_${tag}`] || "").trim().toLowerCase();
    const requireChecksum = String(process.env.LOCAL_NODE_REQUIRE_CHECKSUM || "true").trim().toLowerCase() !== "false";
    if (!url) {
      throw new Error(`Missing kaspad download URL for ${tag}. Set LOCAL_NODE_KASPAD_URL_${tag}.`);
    }
    if (requireChecksum && !checksum) {
      throw new Error(`Missing checksum for ${tag}. Set LOCAL_NODE_KASPAD_SHA256_${tag}.`);
    }

    const downloadsDir = path.join(this.options.baseDataDir, "downloads");
    const unpackDir = path.join(this.options.baseDataDir, "unpack", `${Date.now()}`);
    await this.deps.fsp.mkdir(downloadsDir, { recursive: true });
    await this.deps.fsp.mkdir(unpackDir, { recursive: true });

    const extension = url.toLowerCase().includes(".zip")
      ? ".zip"
      : (url.toLowerCase().includes(".tar.gz") || url.toLowerCase().includes(".tgz") ? ".tar.gz" : "");
    const archivePath = path.join(downloadsDir, `kaspad-${tag}${extension || ".bin"}`);
    const response = await this.deps.fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download kaspad binary (${response.status})`);
    }
    const bodyBytes = new Uint8Array(await response.arrayBuffer());
    await this.deps.fsp.writeFile(archivePath, bodyBytes);

    if (checksum) {
      const digest = await sha256File(this.deps.fsp, archivePath);
      if (digest !== checksum) {
        throw new Error(`Checksum mismatch for kaspad artifact (${digest} != ${checksum})`);
      }
    }

    await this.unpackArtifact(archivePath, unpackDir);
    const discoveredBinary = await findBinaryRecursive(this.deps.fsp, this.deps.processPlatform, unpackDir);
    if (!discoveredBinary) {
      throw new Error("Unable to locate kaspad binary after extraction.");
    }

    await this.deps.fsp.mkdir(path.dirname(targetBinaryPath), { recursive: true });
    await this.deps.fsp.copyFile(discoveredBinary, targetBinaryPath);
    if (this.deps.processPlatform !== "win32") {
      await this.deps.fsp.chmod(targetBinaryPath, 0o755).catch(() => {});
    }
    return targetBinaryPath;
  }

  async unpackArtifact(archivePath, outputDir) {
    const lower = archivePath.toLowerCase();
    if (lower.endsWith(".zip")) {
      if (this.deps.processPlatform === "win32") {
        const result = this.deps.spawnSync("powershell", [
          "-NoProfile",
          "-Command",
          `Expand-Archive -Path "${archivePath}" -DestinationPath "${outputDir}" -Force`,
        ], { stdio: "ignore" });
        if (result.status !== 0) throw new Error("Failed to extract zip artifact.");
        return;
      }
      const unzip = this.deps.spawnSync("unzip", ["-o", archivePath, "-d", outputDir], { stdio: "ignore" });
      if (unzip.status !== 0) throw new Error("Failed to extract zip artifact.");
      return;
    }
    if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
      const tar = this.deps.spawnSync("tar", ["-xzf", archivePath, "-C", outputDir], { stdio: "ignore" });
      if (tar.status !== 0) throw new Error("Failed to extract tar.gz artifact.");
      return;
    }
    // If the downloaded file is already an executable binary.
    const directBinary = path.join(outputDir, path.basename(archivePath));
    await this.deps.fsp.copyFile(archivePath, directBinary);
  }
}

function parseExtraArgs(profile) {
  const key = `LOCAL_NODE_EXTRA_ARGS_${String(profile).toUpperCase().replace(/-/g, "_")}`;
  const raw = String(process.env[key] || process.env.LOCAL_NODE_EXTRA_ARGS || "").trim();
  if (!raw) return [];
  return raw.split(/\s+/).map((value) => value.trim()).filter(Boolean);
}

async function fileExists(fsPromises, fsModule, filePath) {
  try {
    await fsPromises.access(filePath, fsModule.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(fsPromises, filePath) {
  const data = await fsPromises.readFile(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function findBinaryRecursive(fsPromises, platform, rootDir) {
  const candidates = platform === "win32" ? ["kaspad.exe", "kaspad"] : ["kaspad"];
  const entries = await fsPromises.readdir(rootDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findBinaryRecursive(fsPromises, platform, full);
      if (nested) return nested;
      continue;
    }
    if (candidates.includes(entry.name)) return full;
  }
  return "";
}

function sleep(setTimeoutFn, delayMs) {
  return new Promise((resolve) => {
    setTimeoutFn(resolve, delayMs);
  });
}

async function readTailUtf8(fspApi, filePath, maxBytesInput) {
  const maxBytes = Math.max(8 * 1024, Number(maxBytesInput || DEFAULT_LOG_TAIL_MAX_BYTES));
  if (typeof fspApi?.stat !== "function") {
    return String(await fspApi.readFile(filePath, "utf8"));
  }
  const stat = await fspApi.stat(filePath);
  const fileSize = Number(stat?.size || 0);
  if (!Number.isFinite(fileSize) || fileSize <= 0) return "";
  const readBytes = Math.max(1, Math.min(fileSize, maxBytes));

  if (readBytes === fileSize || typeof fspApi?.open !== "function") {
    return String(await fspApi.readFile(filePath, "utf8"));
  }

  const position = Math.max(0, fileSize - readBytes);
  const handle = await fspApi.open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(readBytes);
    const { bytesRead } = await handle.read(buffer, 0, readBytes, position);
    let content = buffer.subarray(0, Math.max(0, bytesRead)).toString("utf8");
    if (position > 0) {
      const newLineIdx = content.indexOf("\n");
      if (newLineIdx >= 0 && newLineIdx + 1 < content.length) {
        content = content.slice(newLineIdx + 1);
      }
    }
    return content;
  } finally {
    await handle.close().catch(() => {});
  }
}

async function fetchWithTimeout(fetchFn, url, timeoutMs) {
  const safeTimeout = Math.max(250, Number(timeoutMs || DEFAULT_RPC_PROBE_TIMEOUT_MS));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), safeTimeout);
  try {
    return await fetchFn(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
