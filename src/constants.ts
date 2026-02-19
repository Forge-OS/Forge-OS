import { resolveKaspaNetwork } from "./kaspa/network";

const env = import.meta.env;

export const NETWORK_PROFILE = resolveKaspaNetwork(env.VITE_KAS_NETWORK || "kaspa_testnet_10");
export const DEFAULT_NETWORK = NETWORK_PROFILE.id;
export const NETWORK_LABEL = env.VITE_KAS_NETWORK_LABEL || NETWORK_PROFILE.label;
export const ALLOWED_ADDRESS_PREFIXES = NETWORK_PROFILE.addressPrefixes;

export const KAS_API =
  env.VITE_KAS_API ||
  (DEFAULT_NETWORK.startsWith("testnet") ? "https://api-tn10.kaspa.org" : "https://api.kaspa.org");
export const KAS_API_FALLBACKS = String(env.VITE_KAS_API_FALLBACKS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

export const EXPLORER =
  env.VITE_KAS_EXPLORER ||
  (DEFAULT_NETWORK.startsWith("testnet") ? "https://explorer-tn10.kaspa.org" : "https://explorer.kaspa.org");
export const KAS_WS_URL = env.VITE_KAS_WS_URL || "";
export const KASPIUM_DEEP_LINK_SCHEME = env.VITE_KASPIUM_DEEP_LINK_SCHEME || "kaspium://";
export const ENFORCE_WALLET_NETWORK = String(env.VITE_KAS_ENFORCE_WALLET_NETWORK || "true").toLowerCase() !== "false";

export const TREASURY = "kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85";
export const FEE_RATE = 0.20;           // KAS per execution cycle
export const TREASURY_SPLIT = 0.30;     // 30% of fees to treasury
export const AGENT_SPLIT    = 0.70;     // 70% of fees to agent pool
export const RESERVE  = 0.50;
export const NET_FEE  = 0.0002;
export const CONF_THRESHOLD = 0.75;
