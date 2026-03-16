// ── Blockchain configuration ─────────────────────────────────────────────────
// Centralises chain parameters, EAS addresses, and env-var access.
// Supports Base mainnet and Base Sepolia; env var BLOCKCHAIN_NETWORK selects.

const CHAINS = {
  base: {
    name: "Base",
    chainId: 8453,
    rpcUrl: process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org",
    blockExplorer: "https://basescan.org",
  },
  "base-sepolia": {
    name: "Base Sepolia",
    chainId: 84532,
    rpcUrl: process.env.BASE_RPC_URL || "https://sepolia.base.org",
    blockExplorer: "https://sepolia.basescan.org",
  },
};

export function isBlockchainEnabled() {
  return process.env.BLOCKCHAIN_ENABLED === "true";
}

export function getChainConfig() {
  const network = process.env.BLOCKCHAIN_NETWORK || "base-sepolia";
  const chain = CHAINS[network];
  if (!chain) {
    throw new Error(
      `Unknown BLOCKCHAIN_NETWORK "${network}". Use "base" or "base-sepolia".`,
    );
  }
  return chain;
}

export function getEASAddresses() {
  return {
    eas:
      process.env.EAS_CONTRACT_ADDRESS ||
      "0x4200000000000000000000000000000000000021",
    schemaRegistry:
      process.env.EAS_SCHEMA_REGISTRY_ADDRESS ||
      "0x4200000000000000000000000000000000000020",
  };
}

export function getSchemaUIDs() {
  return {
    verifiedHuman: process.env.EAS_VERIFIED_HUMAN_SCHEMA_UID || "",
    presenceCheckpoint: process.env.EAS_PRESENCE_CHECKPOINT_SCHEMA_UID || "",
  };
}

export function getAttestationTTLs() {
  return {
    verifiedHuman: parseInt(
      process.env.ATTESTATION_VERIFIED_HUMAN_TTL || "31536000",
      10,
    ),
    presenceCheckpoint: parseInt(
      process.env.ATTESTATION_PRESENCE_CHECKPOINT_TTL || "86400",
      10,
    ),
  };
}
