import { KAS_API, KAS_API_FALLBACKS } from "../constants";
import { fmt } from "../helpers";

const API_ROOT = String(KAS_API || "").replace(/\/+$/, "");
const API_ROOTS = Array.from(new Set([API_ROOT, ...KAS_API_FALLBACKS.map((v) => String(v || "").replace(/\/+$/, ""))]))
  .filter(Boolean);
const REQUEST_TIMEOUT_MS = 12000;

type NetworkHint = "mainnet" | "testnet" | "unknown";

function makeUrl(root: string, path: string) {
  return `${root}${path}`;
}

function endpointNetworkHint(root: string): NetworkHint {
  const value = String(root || "").toLowerCase();
  if(value.includes("tn10") || value.includes("tn11") || value.includes("tn12") || value.includes("testnet")) {
    return "testnet";
  }
  if(value.includes("api.kaspa.org") || value.includes("mainnet")) {
    return "mainnet";
  }
  return "unknown";
}

function pathNetworkHint(path: string): NetworkHint {
  const value = String(path || "").toLowerCase();
  if(value.includes("/addresses/kaspatest:")) return "testnet";
  if(value.includes("/addresses/kaspa:")) return "mainnet";
  return "unknown";
}

function resolveApiRoots(path: string) {
  const pathHint = pathNetworkHint(path);
  if(pathHint === "unknown") return API_ROOTS;

  const preferred = API_ROOTS.filter((root) => {
    const endpointHint = endpointNetworkHint(root);
    return endpointHint === pathHint || endpointHint === "unknown";
  });

  return preferred.length > 0 ? preferred : API_ROOTS;
}

async function fetchJson(path: string) {
  if (API_ROOTS.length === 0) {
    throw new Error("No Kaspa API endpoints configured");
  }

  const requestRoots = resolveApiRoots(path);
  const errors: string[] = [];

  for (const root of requestRoots) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(makeUrl(root, path), {
        method: "GET",
        headers: { "Accept": "application/json" },
        signal: controller.signal,
      });

      if(!res.ok) {
        throw new Error(`${res.status}`);
      }

      return await res.json();
    } catch(err: any) {
      if(err?.name === "AbortError") {
        errors.push(`${root} timeout (${REQUEST_TIMEOUT_MS}ms)`);
      } else {
        errors.push(`${root} ${err?.message || "request_failed"}`);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error(`Kaspa API unavailable for ${path}: ${errors.join(" | ")}`);
}

function encodeAddress(addr: string) {
  const v = String(addr || "").trim();
  if(!v) throw new Error("Missing Kaspa address");
  return encodeURIComponent(v);
}

function extractSompiBalance(payload: any) {
  const raw =
    payload?.balance ??
    payload?.totalBalance ??
    payload?.availableSompi ??
    payload?.balanceSompi ??
    payload?.balances?.total ??
    0;

  const num = Number(raw);
  return Number.isFinite(num) ? Math.max(0, num) : 0;
}

function extractKasBalance(payload: any, sompi: number) {
  const directKas =
    payload?.balanceKas ??
    payload?.kas ??
    payload?.balance_kas ??
    payload?.balances?.kas;

  if(directKas != null) {
    const num = Number(directKas);
    if(Number.isFinite(num)) return Math.max(0, num);
  }

  return sompi / 1e8;
}

function extractUtxos(payload: any) {
  if(Array.isArray(payload)) return payload;
  if(Array.isArray(payload?.utxos)) return payload.utxos;
  if(Array.isArray(payload?.entries)) return payload.entries;
  return [];
}

export async function kasPrice() {
  const payload = await fetchJson("/info/price");
  const price = Number(payload?.price ?? 0);
  if(!Number.isFinite(price)) throw new Error("Invalid price payload from Kaspa API");
  return price;
}

export async function kasBalance(addr: string) {
  const payload = await fetchJson(`/addresses/${encodeAddress(addr)}/balance`);
  const sompi = extractSompiBalance(payload);
  const kas = extractKasBalance(payload, sompi);

  return {
    kas: fmt(kas, 4),
    raw: sompi,
  };
}

export async function kasUtxos(addr: string) {
  const payload = await fetchJson(`/addresses/${encodeAddress(addr)}/utxos`);
  return extractUtxos(payload);
}

export async function kasNetworkInfo() {
  const payload = await fetchJson("/info/blockdag");
  return payload?.blockdag ?? payload?.blockDag ?? payload;
}
