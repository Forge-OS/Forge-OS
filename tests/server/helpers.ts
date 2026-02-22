import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import http from "node:http";
import net from "node:net";

export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

export function spawnNodeProcess(args: string[], opts: { cwd: string; env?: Record<string, string> }) {
  const child = spawn(process.execPath, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => { stdout += String(d); });
  child.stderr.on("data", (d) => { stderr += String(d); });
  return {
    child,
    getStdout: () => stdout,
    getStderr: () => stderr,
  };
}

export async function stopProcess(child: ChildProcessWithoutNullStreams, timeoutMs = 2000) {
  if (child.exitCode != null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      resolve();
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

export async function waitForHttp(url: string, timeoutMs = 8000) {
  const started = Date.now();
  let lastErr: any = null;
  while (Date.now() - started < timeoutMs) {
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

export async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 8000, intervalMs = 100) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("wait_for_condition_timeout");
}

export async function httpJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { res, body, text };
}

export async function startJsonServer(
  port: number,
  handler: (req: http.IncomingMessage, body: any, url: URL) => Promise<{ status?: number; body?: any; headers?: Record<string, string> } | void> | { status?: number; body?: any; headers?: Record<string, string> } | void
) {
  const server = http.createServer(async (req, res) => {
    try {
      let raw = "";
      req.on("data", (chunk) => {
        raw += String(chunk);
      });
      await new Promise<void>((resolve, reject) => {
        req.on("end", () => resolve());
        req.on("error", reject);
      });
      const body = raw ? JSON.parse(raw) : {};
      const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
      const out = (await handler(req, body, url)) || {};
      const status = Number(out.status || 200);
      const headers = { "Content-Type": "application/json", ...(out.headers || {}) };
      res.writeHead(status, headers);
      res.end(JSON.stringify(out.body ?? { ok: true }));
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e?.message || e || "server_error") }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  return server;
}

