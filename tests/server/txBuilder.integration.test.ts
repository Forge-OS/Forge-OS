import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getFreePort, httpJson, spawnNodeProcess, startJsonServer, stopProcess, waitForHttp } from "./helpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

describe("tx-builder integration (command mode)", () => {
  const children: Array<ReturnType<typeof spawnNodeProcess>> = [];
  const servers: Array<{ close: () => void }> = [];

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
  });

  it("builds Kastle txJson through the bundled http-bridge command", async () => {
    const upstreamPort = await getFreePort();
    const txBuilderPort = await getFreePort();

    const upstreamCalls: any[] = [];
    const upstream = await startJsonServer(upstreamPort, async (_req, body, url) => {
      if (url.pathname !== "/v1/build") return { status: 404, body: { error: "not_found" } };
      upstreamCalls.push(body);
      return { body: { txJson: '{"mock":"txjson","outputs":2}' } };
    });
    servers.push(upstream as any);

    const proc = spawnNodeProcess(["server/tx-builder/index.mjs"], {
      cwd: repoRoot,
      env: {
        PORT: String(txBuilderPort),
        HOST: "127.0.0.1",
        TX_BUILDER_COMMAND: "node server/tx-builder/commands/kastle-http-bridge-command.mjs",
        KASTLE_TX_BUILDER_COMMAND_UPSTREAM_URL: `http://127.0.0.1:${upstreamPort}/v1/build`,
      },
    });
    children.push(proc);
    await waitForHttp(`http://127.0.0.1:${txBuilderPort}/health`);

    const build = await httpJson(`http://127.0.0.1:${txBuilderPort}/v1/kastle/build-tx-json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet: "kastle",
        networkId: "mainnet",
        fromAddress: "kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85",
        outputs: [
          { address: "kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85", amountKas: 1.0 },
          { address: "kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85", amountKas: 0.06 },
        ],
        purpose: "combined treasury",
      }),
    });

    expect(build.res.status).toBe(200);
    expect(build.body.txJson).toContain('"mock":"txjson"');
    expect(build.body.meta.mode).toBe("command");
    expect(upstreamCalls).toHaveLength(1);
    expect(upstreamCalls[0].outputs).toHaveLength(2);
  }, 20_000);
});

