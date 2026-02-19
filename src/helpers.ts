export const fmt  = (n: any, d = 4) => parseFloat(n || 0).toFixed(d);
export const fmtT = (ts: any) => new Date(ts).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
export const fmtD = (ts: any) => new Date(ts).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
export const shortAddr = (a: any) => a ? `${a.slice(0,18)}...${a.slice(-6)}` : "—";
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const uid = () => Math.random().toString(36).slice(2,10);

const KASPA_BASE32_REGEX = /^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/i;
const DEFAULT_ALLOWED_PREFIXES = ["kaspa", "kaspatest", "kaspadev", "kaspasim"];

export const isKaspaAddress = (address: any, allowedPrefixes: string[] = DEFAULT_ALLOWED_PREFIXES) => {
  const v = String(address || "").trim().toLowerCase();
  const separatorIndex = v.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === v.length - 1) return false;

  const prefix = v.slice(0, separatorIndex);
  const payload = v.slice(separatorIndex + 1);
  if (!allowedPrefixes.map((p) => p.toLowerCase()).includes(prefix)) return false;
  if (payload.length < 12 || payload.length > 120) return false;
  return KASPA_BASE32_REGEX.test(payload);
};

export const normalizeKaspaAddress = (address: any, allowedPrefixes: string[] = DEFAULT_ALLOWED_PREFIXES) => {
  const v = String(address || "").trim();
  if(!isKaspaAddress(v, allowedPrefixes)) {
    throw new Error(`Invalid Kaspa address for allowed prefixes: ${allowedPrefixes.join(", ")}`);
  }
  const lower = v.toLowerCase();
  const separatorIndex = lower.indexOf(":");
  const prefix = lower.slice(0, separatorIndex);
  const payload = lower.slice(separatorIndex + 1);
  return `${prefix}:${payload}`;
};
