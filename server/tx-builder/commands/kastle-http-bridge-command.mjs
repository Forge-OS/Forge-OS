#!/usr/bin/env node

// Forge.OS reference tx-builder command for TX_BUILDER_COMMAND mode.
// Reads Forge.OS Kastle tx-build request JSON from stdin and proxies it to a
// real upstream tx-builder service, returning normalized { txJson } on stdout.

const UPSTREAM_URL = String(process.env.KASTLE_TX_BUILDER_COMMAND_UPSTREAM_URL || process.env.TX_BUILDER_UPSTREAM_URL || "").trim();
const UPSTREAM_TOKEN = String(process.env.KASTLE_TX_BUILDER_COMMAND_UPSTREAM_TOKEN || process.env.TX_BUILDER_UPSTREAM_TOKEN || "").trim();
const TIMEOUT_MS = Math.max(1000, Number(process.env.KASTLE_TX_BUILDER_COMMAND_TIMEOUT_MS || 15000));

function fail(message, code = 1) {
  process.stderr.write(`${String(message || "tx_builder_command_failed")}\n`);
  process.exit(code);
}

function normalizeAddress(input) {
  const value = String(input || "").trim().toLowerCase();
  if (!value) return "";
  if (!value.startsWith("kaspa:") && !value.startsWith("kaspatest:")) return "";
  return value;
}

function normalizePayload(input) {
  const payload = input && typeof input === "object" ? input : {};
  const wallet = String(payload.wallet || "").trim().toLowerCase();
  const networkId = String(payload.networkId || "").trim();
  const fromAddress = normalizeAddress(payload.fromAddress);
  const outputs = Array.isArray(payload.outputs)
    ? payload.outputs
        .map((o) => ({
          address: normalizeAddress(o?.address || o?.to),
          amountKas: Number(o?.amountKas ?? o?.amount_kas ?? 0),
        }))
        .filter((o) => o.address && Number.isFinite(o.amountKas) && o.amountKas > 0)
    : [];
  if (wallet !== "kastle") throw new Error("unsupported_wallet");
  if (networkId !== "mainnet" && networkId !== "testnet-10") throw new Error("invalid_network_id");
  if (!fromAddress) throw new Error("invalid_from_address");
  if (!outputs.length) throw new Error("outputs_required");
  return {
    wallet: "kastle",
    networkId,
    fromAddress,
    outputs,
    purpose: String(payload.purpose || "").slice(0, 140),
  };
}

async function readStdinJson() {
  let raw = "";
  for await (const chunk of process.stdin) raw += String(chunk);
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

async function postUpstream(payload) {
  if (!UPSTREAM_URL) throw new Error("KASTLE_TX_BUILDER_COMMAND_UPSTREAM_URL required");
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
  try {
    const res = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(UPSTREAM_TOKEN ? { Authorization: `Bearer ${UPSTREAM_TOKEN}` } : {}),
      },
      body: JSON.stringify(payload),
      ...(controller ? { signal: controller.signal } : {}),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`upstream_${res.status}:${text.slice(0, 200)}`);
    const parsed = text ? JSON.parse(text) : {};
    const txJson = typeof parsed === "string" ? parsed : String(parsed?.txJson || parsed?.result?.txJson || "").trim();
    if (!txJson) throw new Error("upstream_missing_txJson");
    return { txJson, meta: { mode: "http-bridge-command", upstream: UPSTREAM_URL } };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

(async () => {
  try {
    const input = await readStdinJson();
    const payload = normalizePayload(input);
    const result = await postUpstream(payload);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (e) {
    fail(String(e?.message || e || "tx_builder_command_failed"));
  }
})();

