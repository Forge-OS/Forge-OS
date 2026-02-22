import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getFreePort, httpJson, spawnNodeProcess, stopProcess, waitForHttp } from "./helpers";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

describe("audit log verifier CLI", () => {
  const children: Array<ReturnType<typeof spawnNodeProcess>> = [];

  afterEach(async () => {
    await Promise.all(children.map((c) => stopProcess(c.child)));
    children.length = 0;
  });

  it("verifies chained JSONL audit export integrity and cryptographic signatures", async () => {
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const port = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeos-audit-verify-"));
    const appendLogPath = path.join(tmpDir, "decision-audit.jsonl");

    const proc = spawnNodeProcess(["server/audit-signer/index.mjs"], {
      cwd: repoRoot,
      env: {
        PORT: String(port),
        HOST: "127.0.0.1",
        AUDIT_SIGNER_PRIVATE_KEY_PEM: privatePem,
        AUDIT_SIGNER_KEY_ID: "verify-test",
        AUDIT_SIGNER_INCLUDE_PUBLIC_KEY: "true",
        AUDIT_SIGNER_APPEND_LOG_PATH: appendLogPath,
      },
    });
    children.push(proc);
    await waitForHttp(`http://127.0.0.1:${port}/health`);

    for (let i = 0; i < 2; i += 1) {
      const signRes = await httpJson(`http://127.0.0.1:${port}/v1/audit-sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signingPayload: {
            audit_record_version: "forgeos.decision.audit.v1",
            hash_algo: "fnv1a32/canonical-json",
            prompt_version: "forgeos.quant.overlay.prompt.v1",
            ai_response_schema_version: "forgeos.ai.decision.schema.v1",
            quant_feature_snapshot_hash: `fnv1a32/canonical-json:q${i}`,
            decision_hash: `fnv1a32/canonical-json:d${i}`,
            overlay_plan_reason: "ai_overlay_mode_always",
            engine_path: "hybrid-ai",
            created_ts: Date.now() + i,
          },
        }),
      });
      expect(signRes.res.status).toBe(200);
    }

    const out = await execFileAsync(process.execPath, ["scripts/verify-audit-log.mjs", "--file", appendLogPath, "--strict-signatures", "--json"], {
      cwd: repoRoot,
    });
    const parsed = JSON.parse(String(out.stdout || "{}"));
    expect(parsed.ok).toBe(true);
    expect(parsed.counters.total).toBe(2);
    expect(parsed.counters.chainInvalid).toBe(0);
    expect(parsed.counters.sigVerified).toBe(2);
  }, 20_000);
});

