export type KaspaNetworkProfile = {
  id: "mainnet" | "testnet-10" | "testnet-11" | "testnet-12" | "devnet" | "simnet";
  label: string;
  aliases: string[];
  addressPrefixes: string[];
};

const PROFILES: readonly KaspaNetworkProfile[] = [
  {
    id: "mainnet",
    label: "Kaspa Mainnet",
    aliases: ["mainnet", "kaspa_mainnet", "kaspa-mainnet", "mainnet-11", "mainnet11"],
    addressPrefixes: ["kaspa"],
  },
  {
    id: "testnet-10",
    label: "Kaspa Testnet 10",
    aliases: ["testnet", "testnet10", "testnet-10", "tn10", "kaspa_testnet_10", "kaspa-testnet-10"],
    addressPrefixes: ["kaspatest"],
  },
  {
    id: "testnet-11",
    label: "Kaspa Testnet 11",
    aliases: ["testnet11", "testnet-11", "tn11", "kaspa_testnet_11", "kaspa-testnet-11"],
    addressPrefixes: ["kaspatest"],
  },
  {
    id: "testnet-12",
    label: "Kaspa Testnet 12",
    aliases: ["testnet12", "testnet-12", "tn12", "kaspa_testnet_12", "kaspa-testnet-12"],
    addressPrefixes: ["kaspatest"],
  },
  {
    id: "devnet",
    label: "Kaspa Devnet",
    aliases: ["devnet", "kaspadev", "kaspa_devnet", "kaspa-devnet"],
    addressPrefixes: ["kaspadev"],
  },
  {
    id: "simnet",
    label: "Kaspa Simnet",
    aliases: ["simnet", "kaspasim", "kaspa_simnet", "kaspa-simnet"],
    addressPrefixes: ["kaspasim"],
  },
];

function normalize(raw: string) {
  return String(raw || "").trim().toLowerCase().replace(/_/g, "-");
}

export function resolveKaspaNetwork(raw: string | undefined | null): KaspaNetworkProfile {
  const normalized = normalize(raw || "testnet-10");
  const match = PROFILES.find((profile) =>
    profile.aliases.some((alias) => normalize(alias) === normalized)
  );

  return match || PROFILES[1];
}

export function isAddressPrefixCompatible(address: string, profile: KaspaNetworkProfile): boolean {
  const idx = address.indexOf(":");
  if (idx < 1) return false;
  const prefix = address.slice(0, idx).toLowerCase();
  return profile.addressPrefixes.includes(prefix);
}
