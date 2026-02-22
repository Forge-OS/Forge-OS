function envNum(name, fallback, min = 0) {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, n);
}

function envInt(name, fallback, min = 0) {
  return Math.max(min, Math.round(envNum(name, fallback, min)));
}

function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null) return fallback;
  return /^(1|true|yes)$/i.test(String(raw));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseCoinSelectionMode(raw) {
  const v = String(raw || "auto").trim().toLowerCase();
  if (v === "largest-first" || v === "smallest-first" || v === "oldest-first" || v === "newest-first") return v;
  return "auto";
}

function parseFeeMode(raw) {
  const v = String(raw || "request_or_fixed").trim().toLowerCase();
  if (v === "fixed" || v === "output_bps" || v === "per_output" || v === "request_or_fixed") return v;
  return "request_or_fixed";
}

export function readLocalTxPolicyConfig() {
  return {
    coinSelection: parseCoinSelectionMode(process.env.TX_BUILDER_LOCAL_WASM_COIN_SELECTION),
    maxInputs: envInt("TX_BUILDER_LOCAL_WASM_MAX_INPUTS", 48, 1),
    estimatedNetworkFeeSompi: envInt("TX_BUILDER_LOCAL_WASM_ESTIMATED_NETWORK_FEE_SOMPI", 20_000, 0),
    perInputFeeBufferSompi: envInt("TX_BUILDER_LOCAL_WASM_PER_INPUT_FEE_BUFFER_SOMPI", 1_500, 0),
    extraSafetyBufferSompi: envInt("TX_BUILDER_LOCAL_WASM_EXTRA_SAFETY_BUFFER_SOMPI", 5_000, 0),
    priorityFeeMode: parseFeeMode(process.env.TX_BUILDER_LOCAL_WASM_PRIORITY_FEE_MODE),
    priorityFeeFixedSompi: envInt("TX_BUILDER_LOCAL_WASM_PRIORITY_FEE_SOMPI", 0, 0),
    priorityFeeOutputBps: envNum("TX_BUILDER_LOCAL_WASM_PRIORITY_FEE_OUTPUT_BPS", 5, 0),
    priorityFeePerOutputSompi: envInt("TX_BUILDER_LOCAL_WASM_PRIORITY_FEE_PER_OUTPUT_SOMPI", 2_000, 0),
    priorityFeeMinSompi: envInt("TX_BUILDER_LOCAL_WASM_PRIORITY_FEE_MIN_SOMPI", 0, 0),
    priorityFeeMaxSompi: envInt("TX_BUILDER_LOCAL_WASM_PRIORITY_FEE_MAX_SOMPI", 2_500_000, 0),
    preferConsolidation: envBool("TX_BUILDER_LOCAL_WASM_PREFER_CONSOLIDATION", true),
  };
}

function amountSompi(entry) {
  return BigInt(Math.max(0, Math.round(Number(entry?.utxoEntry?.amount || 0))));
}

function daaScore(entry) {
  const n = Number(entry?.utxoEntry?.blockDaaScore || 0);
  return Number.isFinite(n) ? n : 0;
}

function coinSort(entries, mode, preferConsolidation) {
  const list = [...entries];
  const byAmountAsc = (a, b) => {
    const diff = amountSompi(a) - amountSompi(b);
    return diff === 0n ? 0 : diff < 0n ? -1 : 1;
  };
  const byAmountDesc = (a, b) => -byAmountAsc(a, b);
  const byDaaAsc = (a, b) => daaScore(a) - daaScore(b);
  const byDaaDesc = (a, b) => daaScore(b) - daaScore(a);

  if (mode === "largest-first") return list.sort((a, b) => byAmountDesc(a, b) || byDaaAsc(a, b));
  if (mode === "smallest-first") return list.sort((a, b) => byAmountAsc(a, b) || byDaaAsc(a, b));
  if (mode === "newest-first") return list.sort((a, b) => byDaaDesc(a, b) || byAmountDesc(a, b));
  if (mode === "oldest-first") return list.sort((a, b) => byDaaAsc(a, b) || byAmountDesc(a, b));
  // auto
  if (preferConsolidation) return list.sort((a, b) => byDaaAsc(a, b) || byAmountAsc(a, b));
  return list.sort((a, b) => byAmountDesc(a, b) || byDaaAsc(a, b));
}

function clampPriorityFeeSompi(n, cfg) {
  return clamp(Math.round(Number(n || 0)), cfg.priorityFeeMinSompi, Math.max(cfg.priorityFeeMinSompi, cfg.priorityFeeMaxSompi));
}

export function computePriorityFeeSompi({ requestPriorityFeeSompi, outputsTotalSompi, outputCount, config }) {
  const cfg = config || readLocalTxPolicyConfig();
  const requestFee = Math.max(0, Math.round(Number(requestPriorityFeeSompi || 0)));
  if (cfg.priorityFeeMode === "fixed") return clampPriorityFeeSompi(cfg.priorityFeeFixedSompi, cfg);
  if (cfg.priorityFeeMode === "output_bps") {
    const base = Number(outputsTotalSompi > 0n ? outputsTotalSompi : 0n);
    const fee = Math.round((base * Number(cfg.priorityFeeOutputBps || 0)) / 10_000);
    return clampPriorityFeeSompi(fee, cfg);
  }
  if (cfg.priorityFeeMode === "per_output") {
    const fee = Math.max(0, Math.round(Number(outputCount || 0))) * Math.max(0, Math.round(cfg.priorityFeePerOutputSompi));
    return clampPriorityFeeSompi(fee, cfg);
  }
  // request_or_fixed
  return clampPriorityFeeSompi(requestFee > 0 ? requestFee : cfg.priorityFeeFixedSompi, cfg);
}

export function selectUtxoEntriesForLocalBuild({ entries, outputsTotalSompi, outputCount, requestPriorityFeeSompi, config }) {
  const cfg = config || readLocalTxPolicyConfig();
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  if (!normalizedEntries.length) {
    return {
      selectedEntries: [],
      selectedAmountSompi: 0n,
      outputsTotalSompi,
      requiredTargetSompi: 0n,
      priorityFeeSompi: 0,
      selectionMode: cfg.coinSelection,
      totalEntries: 0,
      truncatedByMaxInputs: false,
    };
  }

  const priorityFeeSompi = computePriorityFeeSompi({
    requestPriorityFeeSompi,
    outputsTotalSompi,
    outputCount,
    config: cfg,
  });
  const ordered = coinSort(normalizedEntries, cfg.coinSelection, cfg.preferConsolidation);

  const baseTargetSompi =
    BigInt(outputsTotalSompi || 0n) +
    BigInt(Math.max(0, cfg.estimatedNetworkFeeSompi)) +
    BigInt(Math.max(0, cfg.extraSafetyBufferSompi)) +
    BigInt(Math.max(0, priorityFeeSompi));

  const selectedEntries = [];
  let selectedAmountSompi = 0n;
  let truncatedByMaxInputs = false;
  for (const entry of ordered) {
    if (selectedEntries.length >= cfg.maxInputs) {
      truncatedByMaxInputs = true;
      break;
    }
    selectedEntries.push(entry);
    selectedAmountSompi += amountSompi(entry);
    const dynamicTargetSompi =
      baseTargetSompi + BigInt(selectedEntries.length) * BigInt(Math.max(0, cfg.perInputFeeBufferSompi));
    if (selectedAmountSompi >= dynamicTargetSompi) break;
  }

  const requiredTargetSompi =
    baseTargetSompi + BigInt(selectedEntries.length) * BigInt(Math.max(0, cfg.perInputFeeBufferSompi));

  return {
    selectedEntries,
    selectedAmountSompi,
    outputsTotalSompi,
    requiredTargetSompi,
    priorityFeeSompi,
    selectionMode: cfg.coinSelection,
    totalEntries: ordered.length,
    truncatedByMaxInputs,
    config: cfg,
  };
}

export function describeLocalTxPolicyConfig(config = readLocalTxPolicyConfig()) {
  return {
    coinSelection: config.coinSelection,
    maxInputs: config.maxInputs,
    estimatedNetworkFeeSompi: config.estimatedNetworkFeeSompi,
    perInputFeeBufferSompi: config.perInputFeeBufferSompi,
    extraSafetyBufferSompi: config.extraSafetyBufferSompi,
    priorityFeeMode: config.priorityFeeMode,
    priorityFeeFixedSompi: config.priorityFeeFixedSompi,
    priorityFeeOutputBps: config.priorityFeeOutputBps,
    priorityFeePerOutputSompi: config.priorityFeePerOutputSompi,
    priorityFeeMinSompi: config.priorityFeeMinSompi,
    priorityFeeMaxSompi: config.priorityFeeMaxSompi,
    preferConsolidation: config.preferConsolidation,
  };
}

