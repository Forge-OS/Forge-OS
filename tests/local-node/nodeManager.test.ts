import nodeFs from "node:fs";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { NodeManager } from "../../server/local-node/modules/nodeManager.mjs";

function createScheduler() {
  const timers: Array<{ cb: () => Promise<void> | void; delay: number }> = [];
  const setTimeout = vi.fn((cb: () => Promise<void> | void, delay: number) => {
    const entry = { cb, delay };
    timers.push(entry);
    return entry;
  });
  const clearTimeout = vi.fn((handle: unknown) => {
    const index = timers.findIndex((entry) => entry === handle);
    if (index >= 0) timers.splice(index, 1);
  });
  return { timers, setTimeout, clearTimeout };
}

function createFsMocks() {
  const defaultHandle = {
    read: vi.fn(async () => ({ bytesRead: 0 })),
    close: vi.fn(async () => {}),
  };
  const fsp = {
    access: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
    appendFile: vi.fn(async () => {}),
    readFile: vi.fn(async () => ""),
    stat: vi.fn(async () => ({ size: 0 })),
    open: vi.fn(async () => defaultHandle),
    writeFile: vi.fn(async () => {}),
    copyFile: vi.fn(async () => {}),
    chmod: vi.fn(async () => {}),
    readdir: vi.fn(async () => []),
  };
  const fs = {
    ...nodeFs,
    constants: nodeFs.constants,
    accessSync: vi.fn(() => {}),
    createWriteStream: vi.fn(),
  };
  return { fs, fsp };
}

function createMockChild(pid: number) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    killed: boolean;
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.pid = pid;
  child.killed = false;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => {
    child.killed = true;
    child.emit("exit", 0);
    return true;
  });
  return child;
}

function createHealthyFetch(blockCount = 100, headerCount = 100) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ blockCount, headerCount }),
    arrayBuffer: async () => new ArrayBuffer(0),
  }));
}

describe("NodeManager", () => {
  it("starts/stops kaspad and reports sync status", async () => {
    const { fs, fsp } = createFsMocks();
    const scheduler = createScheduler();
    const child = createMockChild(32101);
    const spawn = vi.fn(() => child);
    const fetch = createHealthyFetch(250, 250);

    const manager = new NodeManager(
      { binaryPath: "/mock/bin/kaspad", autoInstall: false },
      {
        fs,
        fsp,
        spawn,
        spawnSync: vi.fn(),
        fetch,
        setTimeout: scheduler.setTimeout,
        clearTimeout: scheduler.clearTimeout,
        processPlatform: "linux",
        processArch: "x64",
      },
    );

    const started = await manager.start({ networkProfile: "mainnet", dataDir: "/tmp/forge-node" });
    expect(started.running).toBe(true);
    expect(started.pid).toBe(32101);
    expect(started.rpcBaseUrl).toBe("http://127.0.0.1:16110");
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0]?.[1]).toContain("--rpclisten=127.0.0.1:16110");
    expect(spawn.mock.calls[0]?.[1]).toContain("--listen=0.0.0.0:16111");
    expect(await manager.isSynced()).toBe(true);

    const stopped = await manager.stop();
    expect(stopped.running).toBe(false);
    expect(stopped.pid).toBeNull();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("restarts with backoff after crash", async () => {
    const { fs, fsp } = createFsMocks();
    const scheduler = createScheduler();
    const first = createMockChild(401);
    const second = createMockChild(402);
    const spawn = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => second);

    const manager = new NodeManager(
      { binaryPath: "/mock/bin/kaspad", autoInstall: false, restartBackoffBaseMs: 1000, restartBackoffMaxMs: 4000 },
      {
        fs,
        fsp,
        spawn,
        spawnSync: vi.fn(),
        fetch: createHealthyFetch(),
        setTimeout: scheduler.setTimeout,
        clearTimeout: scheduler.clearTimeout,
        processPlatform: "linux",
        processArch: "x64",
      },
    );

    await manager.start({ networkProfile: "mainnet" });
    first.emit("exit", 1);

    const crashed = manager.status();
    expect(crashed.running).toBe(false);
    expect(crashed.restartCount).toBe(1);
    expect(crashed.backoffMs).toBe(1000);
    expect(scheduler.timers).toHaveLength(1);
    expect(scheduler.timers[0]?.delay).toBe(1000);

    await scheduler.timers[0]?.cb();
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(manager.status().running).toBe(true);
    expect(manager.status().pid).toBe(402);
  });

  it("switches network profile by restarting process with profile args", async () => {
    const { fs, fsp } = createFsMocks();
    const scheduler = createScheduler();
    const first = createMockChild(901);
    const second = createMockChild(902);
    const spawn = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => second);

    const manager = new NodeManager(
      { binaryPath: "/mock/bin/kaspad", autoInstall: false },
      {
        fs,
        fsp,
        spawn,
        spawnSync: vi.fn(),
        fetch: createHealthyFetch(),
        setTimeout: scheduler.setTimeout,
        clearTimeout: scheduler.clearTimeout,
        processPlatform: "linux",
        processArch: "x64",
      },
    );

    await manager.start({ networkProfile: "mainnet", dataDir: "/tmp/forge-node" });
    await manager.start({ networkProfile: "tn12", dataDir: "/tmp/forge-node" });

    expect(spawn).toHaveBeenCalledTimes(2);
    const secondArgs = spawn.mock.calls[1]?.[1] as string[];
    expect(secondArgs).toContain("--testnet");
    expect(secondArgs).toContain("--netsuffix=12");
    expect(secondArgs).toContain("--rpclisten=127.0.0.1:16410");
    expect(secondArgs).toContain("--listen=0.0.0.0:16411");
    expect(manager.status().networkProfile).toBe("testnet-12");
  });

  it("tails log file using bounded byte reads instead of full-file read", async () => {
    const { fs, fsp } = createFsMocks();
    const scheduler = createScheduler();
    const lineBlob = "l1\nl2\nl3\n";
    const handle = {
      read: vi.fn(async (buffer: Buffer, offset: number) => {
        const written = buffer.write(lineBlob, offset, "utf8");
        return { bytesRead: written };
      }),
      close: vi.fn(async () => {}),
    };
    fsp.stat.mockResolvedValue({ size: 2 * 1024 * 1024 });
    fsp.open.mockResolvedValue(handle);

    const manager = new NodeManager(
      { binaryPath: "/mock/bin/kaspad", autoInstall: false, logTailMaxBytes: 64 * 1024 },
      {
        fs,
        fsp,
        spawn: vi.fn(() => createMockChild(1001)),
        spawnSync: vi.fn(),
        fetch: createHealthyFetch(),
        setTimeout: scheduler.setTimeout,
        clearTimeout: scheduler.clearTimeout,
        processPlatform: "linux",
        processArch: "x64",
      },
    );

    await manager.start({ networkProfile: "mainnet", dataDir: "/tmp/forge-node" });
    const logs = await manager.getLogsTail(2);

    expect(logs).toContain("l3");
    expect(fsp.open).toHaveBeenCalledTimes(1);
    expect(fsp.readFile).not.toHaveBeenCalled();
  });
});
