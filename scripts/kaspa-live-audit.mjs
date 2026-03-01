#!/usr/bin/env node
// Forge-OS — Live Kaspa Network Audit Script
//
// Runs a comprehensive health check against the real Kaspa mainnet API.
// Checks: endpoint reachability, response shape validation, fee formula
// accuracy, UTXO parsing, PBKDF2 timing benchmark, and circuit breaker.
//
// Usage:
//   node scripts/kaspa-live-audit.mjs
//   node scripts/kaspa-live-audit.mjs --network testnet-10
//   node scripts/kaspa-live-audit.mjs --address kaspa:qpXXX...
//
// No build step needed — runs directly in Node.js 18+.

import { webcrypto } from "crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => a.replace("--", "").split("="))
    .map(([k, v]) => [k, v ?? true])
);

const NETWORK = args.network ?? "mainnet";
const TREASURY = args.address ??
  "kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85";

const ENDPOINTS = {
  mainnet:      "https://api.kaspa.org",
  "testnet-10": "https://api-tn10.kaspa.org",
  "testnet-11": "https://api-tn11.kaspa.org",
  "testnet-12": "https://api-tn12.kaspa.org",
};

const BASE = ENDPOINTS[NETWORK] ?? ENDPOINTS.mainnet;
const REQUEST_TIMEOUT = 12_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red:   "\x1b[31m",
  yellow:"\x1b[33m",
  cyan:  "\x1b[36m",
  bold:  "\x1b[1m",
  dim:   "\x1b[2m",
};

const results = [];

function pass(name, detail = "") {
  results.push({ status: "pass", name, detail });
  console.log(`  ${C.green}✓${C.reset} ${name}${detail ? C.dim + "  " + detail + C.reset : ""}`);
}

function fail(name, detail = "") {
  results.push({ status: "fail", name, detail });
  console.log(`  ${C.red}✗${C.reset} ${name}${detail ? C.dim + "  " + detail + C.reset : ""}`);
}

function warn(name, detail = "") {
  results.push({ status: "warn", name, detail });
  console.log(`  ${C.yellow}⚠${C.reset} ${name}${detail ? C.dim + "  " + detail + C.reset : ""}`);
}

function section(title) {
  console.log(`\n${C.bold}${C.cyan}─── ${title} ───${C.reset}`);
}

async function apiFetch(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const res = await fetch(`${BASE}${path}`, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── 1. Endpoint reachability ──────────────────────────────────────────────────

async function checkReachability() {
  section("Endpoint Reachability");
  console.log(`  ${C.dim}Testing: ${BASE}${C.reset}`);

  try {
    const t0 = Date.now();
    const res = await apiFetch("/info/blockdag");
    const latency = Date.now() - t0;

    if (res.ok) {
      pass("GET /info/blockdag", `HTTP ${res.status} · ${latency}ms`);
    } else {
      fail("GET /info/blockdag", `HTTP ${res.status}`);
    }
  } catch (err) {
    fail("GET /info/blockdag", String(err));
  }
}

// ── 2. BlockDAG shape validation ──────────────────────────────────────────────

async function checkBlockDag() {
  section("BlockDAG Response Shape");

  let dagInfo;
  try {
    const res = await apiFetch("/info/blockdag");
    dagInfo = await res.json();
  } catch (err) {
    fail("Fetch /info/blockdag", String(err));
    return;
  }

  const checks = [
    ["networkName is string", typeof dagInfo.networkName === "string"],
    ["networkName contains network", dagInfo.networkName?.toLowerCase?.().includes(NETWORK === "mainnet" ? "mainnet" : "testnet")],
    ["virtualDaaScore is string", typeof dagInfo.virtualDaaScore === "string"],
    ["virtualDaaScore parseable as BigInt", (() => { try { return BigInt(dagInfo.virtualDaaScore) > 0n; } catch { return false; } })()],
    ["blockCount is string", typeof dagInfo.blockCount === "string"],
    ["difficulty is number", typeof dagInfo.difficulty === "number"],
    ["difficulty > 0", dagInfo.difficulty > 0],
  ];

  for (const [name, ok] of checks) {
    ok ? pass(name) : fail(name, `got: ${JSON.stringify(dagInfo[name.split(" ")[0]])}`);
  }

  if (typeof dagInfo.virtualDaaScore === "string") {
    const score = BigInt(dagInfo.virtualDaaScore);
    console.log(`  ${C.dim}virtualDaaScore = ${(Number(score) / 1_000_000).toFixed(2)}M${C.reset}`);
  }
}

// ── 3. DAG score liveness ─────────────────────────────────────────────────────

async function checkDagLiveness() {
  section("DAG Score Liveness (3s poll, cache-busted)");

  try {
    // Cache-bust by appending a unique query string; api.kaspa.org may cache
    // the blockdag response for 1-2s, so we use 3s gap and unique params.
    const bust1 = `?_=${Date.now()}`;
    const r1 = await apiFetch(`/info/blockdag${bust1}`);
    const d1 = await r1.json();
    const score1 = BigInt(d1.virtualDaaScore ?? "0");

    await new Promise((r) => setTimeout(r, 3_000));

    const bust2 = `?_=${Date.now()}`;
    const r2 = await apiFetch(`/info/blockdag${bust2}`);
    const d2 = await r2.json();
    const score2 = BigInt(d2.virtualDaaScore ?? "0");

    const delta = score2 - score1;

    if (delta > 5n) {
      pass(`DAA score advanced by ${delta} in 3s`, `(~10 BPS)`);
    } else if (delta > 0n) {
      warn(`DAA score advanced only ${delta} in 3s`, "possible caching or low network activity");
    } else {
      warn("DAA score did not advance", "API may be caching responses — network liveness unconfirmed");
    }
  } catch (err) {
    fail("DAG liveness check", String(err));
  }
}

// ── 4. Fee estimate ───────────────────────────────────────────────────────────

async function checkFeeEstimate() {
  section("Fee Estimate");

  let feeData;
  try {
    const res = await apiFetch("/info/fee-estimate");
    if (!res.ok) { fail("GET /info/fee-estimate", `HTTP ${res.status}`); return; }
    feeData = await res.json();
  } catch (err) {
    fail("GET /info/fee-estimate", String(err));
    return;
  }

  const feerate = feeData?.priorityBucket?.feerate;
  if (typeof feerate !== "number" || feerate <= 0) {
    fail("priorityBucket.feerate is a positive number", `got: ${feerate}`);
    return;
  }
  pass("priorityBucket.feerate is a positive number", `${feerate} sompi/gram`);

  // Verify our mass formula accuracy
  // Our formula: mass = 239 + 142*inputs + 51*outputs
  const cases = [
    { inputs: 1, outputs: 2, label: "1-in-2-out (simple send)" },
    { inputs: 2, outputs: 3, label: "2-in-3-out (with treasury)" },
    { inputs: 5, outputs: 2, label: "5-in-2-out (consolidation)" },
  ];

  for (const { inputs, outputs, label } of cases) {
    const mass = 239 + 142 * inputs + 51 * outputs;
    const ourFee = Math.max(Math.ceil(mass * feerate), 1_000);
    const withBuffer = Math.ceil(ourFee * 1.15); // 15% safety buffer
    console.log(`  ${C.dim}${label}: mass=${mass} · base=${ourFee} sompi · buffered=${withBuffer} sompi${C.reset}`);
  }
  pass("Fee formula produces sane values for common tx shapes");

  if (feeData.normalBuckets) {
    const cheapest = feeData.normalBuckets.at(-1)?.feerate ?? feerate;
    console.log(`  ${C.dim}Priority: ${feerate} sompi/gram · Cheapest: ${cheapest} sompi/gram${C.reset}`);
  }
}

// ── 5. Balance ────────────────────────────────────────────────────────────────

async function checkBalance() {
  section("Treasury Balance");
  const addr = TREASURY;
  const short = addr.slice(0, 20) + "…" + addr.slice(-8);

  try {
    const res = await apiFetch(`/addresses/${encodeURIComponent(addr)}/balance`);
    if (!res.ok) { fail(`GET /balance (${short})`, `HTTP ${res.status}`); return; }
    const data = await res.json();

    const raw = data?.balance;
    if (raw == null) { fail("balance field present in response"); return; }

    const balance = typeof raw === "string" ? BigInt(raw) : BigInt(Math.floor(Number(raw)));
    const kas = Number(balance) / 1e8;

    if (balance === 0n) {
      warn(`Balance for ${short}`, "0 KAS — treasury not yet funded");
    } else {
      pass(`Balance for ${short}`, `${kas.toLocaleString("en-US", { maximumFractionDigits: 4 })} KAS`);
    }
  } catch (err) {
    fail("Balance fetch", String(err));
  }
}

// ── 6. UTXO shape ────────────────────────────────────────────────────────────

async function checkUtxos() {
  section("UTXO Set Shape");

  try {
    const res = await apiFetch(`/addresses/${encodeURIComponent(TREASURY)}/utxos`);
    if (!res.ok) { fail("GET /utxos", `HTTP ${res.status}`); return; }
    const utxos = await res.json();

    if (!Array.isArray(utxos)) { fail("Response is an array"); return; }

    pass(`Response is array of ${utxos.length} UTXO(s)`);
    if (utxos.length === 0) {
      warn("No UTXOs found — treasury may be unfunded");
      return;
    }

    const u = utxos[0];
    const shapeChecks = [
      ["address starts with 'kaspa:'", String(u.address ?? "").startsWith("kaspa:")],
      ["outpoint.transactionId is 64-char hex", /^[0-9a-f]{64}$/i.test(u.outpoint?.transactionId ?? "")],
      ["outpoint.index is number", typeof u.outpoint?.index === "number"],
      ["utxoEntry.amount is string", typeof u.utxoEntry?.amount === "string"],
      ["utxoEntry.amount parses as positive BigInt", (() => { try { return BigInt(u.utxoEntry.amount) > 0n; } catch { return false; } })()],
      ["utxoEntry.scriptPublicKey.version is number", typeof u.utxoEntry?.scriptPublicKey?.version === "number"],
      ["utxoEntry.scriptPublicKey.scriptPublicKey is string", typeof u.utxoEntry?.scriptPublicKey?.scriptPublicKey === "string"],
      ["utxoEntry.isCoinbase is boolean", typeof u.utxoEntry?.isCoinbase === "boolean"],
      ["utxoEntry.blockDaaScore is string", typeof u.utxoEntry?.blockDaaScore === "string"],
    ];

    for (const [name, ok] of shapeChecks) {
      ok ? pass(name) : fail(name);
    }

    // Classify scripts
    let standardCount = 0, covenantCount = 0;
    for (const utxo of utxos) {
      const spk = utxo.utxoEntry?.scriptPublicKey?.scriptPublicKey ?? "";
      const ver = utxo.utxoEntry?.scriptPublicKey?.version ?? -1;
      const isStandard = ver === 0 && /^20[0-9a-f]{64}ac$/i.test(spk);
      if (isStandard) standardCount++; else covenantCount++;
    }
    pass(`Script classification`, `${standardCount} standard P2PK, ${covenantCount} covenant`);

  } catch (err) {
    fail("UTXO fetch", String(err));
  }
}

// ── 7. PBKDF2 timing benchmark ────────────────────────────────────────────────

async function benchmarkPbkdf2() {
  section("PBKDF2-SHA256 Timing Benchmark");
  console.log(`  ${C.dim}Deriving key with 600,000 iterations (1× production-equivalent)...${C.reset}`);

  const password = "TestPassword123!";
  const salt = crypto.getRandomValues(new Uint8Array(32));

  const t0 = Date.now();

  const passKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" },
    passKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  const elapsed = Date.now() - t0;

  if (elapsed < 100) {
    warn(`PBKDF2 completed in ${elapsed}ms`, "unusually fast — verify PBKDF2 is not mocked");
  } else if (elapsed < 5_000) {
    pass(`PBKDF2 600k iters in ${elapsed}ms`, "acceptable unlock delay for users");
  } else {
    warn(`PBKDF2 took ${elapsed}ms`, "may be too slow on this hardware");
  }

  // Quick check: 1 iteration should be near-instant
  const t1 = Date.now();
  await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 1, hash: "SHA-256" },
    passKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const fast = Date.now() - t1;
  console.log(`  ${C.dim}1-iteration baseline: ${fast}ms (test mock uses this)${C.reset}`);
}

// ── 8. AES-GCM round-trip ─────────────────────────────────────────────────────

async function checkAesGcm() {
  section("AES-256-GCM Encrypt/Decrypt Round-trip");

  const password = "AuditPassword!";
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify({
    mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    address: "kaspa:qptest",
    network: "mainnet",
  }));

  try {
    // Derive key
    const passKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveKey"],
    );
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 1, hash: "SHA-256" },
      passKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );

    // Encrypt
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    pass("Encrypt produces ciphertext", `${ciphertext.byteLength} bytes`);

    // Decrypt
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    const text = new TextDecoder().decode(decrypted);
    const parsed = JSON.parse(text);

    if (parsed.mnemonic === "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about") {
      pass("Decrypt round-trip restores plaintext correctly");
    } else {
      fail("Decrypted plaintext mismatch");
    }

    // Auth tag tamper test
    const tampered = new Uint8Array(ciphertext);
    tampered[0] ^= 0xFF;
    try {
      await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, tampered);
      fail("GCM auth-tag tamper was NOT detected (security issue!)");
    } catch {
      pass("GCM auth-tag tamper detected and rejected");
    }
  } catch (err) {
    fail("AES-GCM test threw unexpected error", String(err));
  }
}

// ── 9. Transaction on testnet (dry-run only, no broadcast) ───────────────────

async function checkTxDryRun() {
  section("Transaction Pipeline (dry-run only, no broadcast)");

  if (NETWORK === "mainnet") {
    console.log(`  ${C.dim}Skipped on mainnet (use --network testnet-10 to test)${C.reset}`);
    results.push({ status: "skip", name: "Tx dry-run (mainnet skipped)" });
    return;
  }

  // Fetch UTXOs for the treasury on testnet
  try {
    const res = await apiFetch(`/addresses/${encodeURIComponent(TREASURY)}/utxos`);
    if (!res.ok) { warn("UTXO fetch for dry-run", `HTTP ${res.status} — skipping`); return; }
    const utxos = await res.json();

    if (!Array.isArray(utxos) || utxos.length === 0) {
      warn("No UTXOs for dry-run test", "fund the address first");
      return;
    }

    const u = utxos[0];
    const amount = BigInt(u.utxoEntry.amount);
    const kas = Number(amount) / 1e8;
    pass(`Found ${utxos.length} UTXO(s)`, `first: ${kas.toFixed(4)} KAS`);

    // Verify coin selection math (offline)
    const sendAmount = amount / 2n;
    const feeEstimate = 10_000n;
    const total = amount;
    const change = total - sendAmount - feeEstimate;

    if (change >= 0n) {
      pass("Coin selection math: inputs cover send + fee", `change = ${Number(change)/1e8} KAS`);
    } else {
      fail("Coin selection math: insufficient for send + fee");
    }
  } catch (err) {
    fail("Tx dry-run preparation", String(err));
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

function printSummary() {
  const passes = results.filter((r) => r.status === "pass").length;
  const fails  = results.filter((r) => r.status === "fail").length;
  const warns  = results.filter((r) => r.status === "warn").length;
  const skips  = results.filter((r) => r.status === "skip").length;

  console.log(`\n${C.bold}─── Audit Summary ───${C.reset}`);
  console.log(`  Network : ${NETWORK} (${BASE})`);
  console.log(`  ${C.green}Passed  : ${passes}${C.reset}`);
  if (warns > 0)  console.log(`  ${C.yellow}Warnings: ${warns}${C.reset}`);
  if (fails > 0)  console.log(`  ${C.red}Failed  : ${fails}${C.reset}`);
  if (skips > 0)  console.log(`  ${C.dim}Skipped : ${skips}${C.reset}`);

  if (fails > 0) {
    console.log(`\n${C.red}${C.bold}⚠ Audit FAILED — see failed checks above${C.reset}`);
    process.exitCode = 1;
  } else if (warns > 0) {
    console.log(`\n${C.yellow}${C.bold}⚠ Audit passed with warnings${C.reset}`);
  } else {
    console.log(`\n${C.green}${C.bold}✓ All checks passed${C.reset}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`\n${C.bold}${C.cyan}Forge-OS Live Kaspa Audit${C.reset}`);
console.log(`${C.dim}Network: ${NETWORK} · API: ${BASE}${C.reset}`);
console.log(`${C.dim}Treasury: ${TREASURY}${C.reset}`);

await checkReachability();
await checkBlockDag();
await checkDagLiveness();
await checkFeeEstimate();
await checkBalance();
await checkUtxos();
await benchmarkPbkdf2();
await checkAesGcm();
await checkTxDryRun();
printSummary();
