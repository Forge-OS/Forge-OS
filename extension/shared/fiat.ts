export type DisplayCurrency = "USD" | "EUR" | "GBP" | "JPY" | "CAD";

export const DEFAULT_DISPLAY_CURRENCY: DisplayCurrency = "USD";

export const DISPLAY_CURRENCY_OPTIONS: Array<{ code: DisplayCurrency; label: string }> = [
  { code: "USD", label: "US Dollar (USD)" },
  { code: "EUR", label: "Euro (EUR)" },
  { code: "GBP", label: "British Pound (GBP)" },
  { code: "JPY", label: "Japanese Yen (JPY)" },
  { code: "CAD", label: "Canadian Dollar (CAD)" },
];

// Approximate USD FX multipliers for UI display conversion.
// KAS price source remains USD from the Kaspa API.
const USD_TO_FIAT_RATE: Record<DisplayCurrency, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 150.0,
  CAD: 1.36,
};

export function normalizeDisplayCurrency(raw: unknown): DisplayCurrency {
  const code = String(raw || "").trim().toUpperCase();
  if (code === "USD" || code === "EUR" || code === "GBP" || code === "JPY" || code === "CAD") {
    return code;
  }
  return DEFAULT_DISPLAY_CURRENCY;
}

export function convertUsdToDisplayCurrency(amountUsd: number, currency: DisplayCurrency): number {
  const rate = USD_TO_FIAT_RATE[currency] ?? 1;
  return amountUsd * rate;
}

export function formatFiatFromUsd(amountUsd: number, currency: DisplayCurrency): string {
  const converted = convertUsdToDisplayCurrency(amountUsd, currency);
  const fractionDigits = currency === "JPY" ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(converted);
}
