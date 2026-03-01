import path from "node:path";

export const LOCAL_NODE_PROFILES = /** @type {const} */ ({
  mainnet: {
    label: "mainnet",
    defaultRpcPort: 16110,
    defaultP2pPort: 16111,
    args: [],
  },
  "testnet-10": {
    label: "testnet-10",
    defaultRpcPort: 16210,
    defaultP2pPort: 16211,
    args: ["--testnet", "--netsuffix=10"],
  },
  "testnet-11": {
    label: "testnet-11",
    defaultRpcPort: 16310,
    defaultP2pPort: 16311,
    args: ["--testnet", "--netsuffix=11"],
  },
  "testnet-12": {
    label: "testnet-12",
    defaultRpcPort: 16410,
    defaultP2pPort: 16411,
    args: ["--testnet", "--netsuffix=12"],
  },
});

/**
 * Normalize network profile labels.
 * @param {string} input
 * @returns {"mainnet"|"testnet-10"|"testnet-11"|"testnet-12"}
 */
export function normalizeNetworkProfile(input) {
  const raw = String(input || "").trim().toLowerCase().replace(/_/g, "-");
  if (raw === "testnet-10" || raw === "tn10") return "testnet-10";
  if (raw === "testnet-11" || raw === "tn11") return "testnet-11";
  if (raw === "testnet-12" || raw === "tn12") return "testnet-12";
  return "mainnet";
}

/**
 * Build profile-specific kaspad args. Chain params stay encapsulated here.
 * @param {object} params
 * @param {string} params.profile
 * @param {string} params.profileDataDir
 * @param {string} params.logDir
 * @param {string} params.rpcHost
 * @param {number} params.rpcPort
 * @param {string} params.p2pHost
 * @param {number} params.p2pPort
 * @param {string[]} [params.extraArgs]
 * @returns {string[]}
 */
export function buildKaspadArgs(params) {
  const profile = normalizeNetworkProfile(params.profile);
  const spec = LOCAL_NODE_PROFILES[profile];
  const args = [
    ...spec.args,
    `--appdir=${path.resolve(params.profileDataDir)}`,
    `--logdir=${path.resolve(params.logDir)}`,
    `--rpclisten=${params.rpcHost}:${params.rpcPort || spec.defaultRpcPort}`,
    `--listen=${params.p2pHost}:${params.p2pPort || spec.defaultP2pPort}`,
    "--utxoindex",
  ];
  if (Array.isArray(params.extraArgs) && params.extraArgs.length > 0) {
    args.push(...params.extraArgs.filter(Boolean));
  }
  return args;
}

/**
 * Remote endpoint defaults used when local node backend is unavailable.
 */
export function defaultRemoteRpcPools() {
  return {
    mainnet: ["https://api.kaspa.org"],
    "testnet-10": ["https://api-tn10.kaspa.org"],
    "testnet-11": ["https://api-tn11.kaspa.org"],
    "testnet-12": ["https://api-tn12.kaspa.org"],
  };
}
