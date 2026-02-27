// Kaspa REST API helpers for the extension
import { fetchBalance, fetchKasPrice, broadcastTx } from "../network/kaspaClient";

export async function fetchKasBalance(address: string, network = "mainnet"): Promise<number> {
  const sompi = await fetchBalance(address, network);
  return Number(sompi) / 1e8;
}

export async function fetchKasUsdPrice(network = "mainnet"): Promise<number> {
  return fetchKasPrice(network);
}

export async function broadcastTransaction(txJson: string, network = "mainnet"): Promise<string> {
  let payload: object;
  try {
    payload = JSON.parse(txJson);
  } catch {
    throw new Error("Broadcast failed: invalid transaction JSON");
  }
  return broadcastTx(payload, network);
}
