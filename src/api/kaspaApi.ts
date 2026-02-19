import { KAS_API } from "../constants";
import { fmt } from "../helpers";

const API_ROOT = String(KAS_API || "").replace(/\/+$/, "");
const REQUEST_TIMEOUT_MS = 12000;

function makeUrl(path: string) {
  return `${API_ROOT}${path}`;
}

async function fetchJson(path: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(makeUrl(path), {
      method: "GET",
      headers: { "Accept": "application/json" },
      signal: controller.signal,
    });

    if(!res.ok) {
      throw new Error(`${path} ${res.status}`);
    }

    return await res.json();
  } catch(err: any) {
    if(err?.name === "AbortError") {
      throw new Error(`Kaspa API timeout (${REQUEST_TIMEOUT_MS}ms): ${path}`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
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
