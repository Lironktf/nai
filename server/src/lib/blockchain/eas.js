// ── EAS (Ethereum Attestation Service) client ────────────────────────────────
// Issues, revokes, and queries attestations on Base via the EAS SDK.
//
// Privacy model:
//   - On-chain data contains ONLY: wallet address (as recipient), attestation
//     type fields (isHuman bool, source string), timestamps, and expiry.
//   - NO personal identity data (names, biometrics, KYC details) is published.
//   - The NAI backend is the sole issuer — users do not write to the contract.

// The EAS SDK's ESM build omits .js extensions, which breaks under Node.js v24's
// strict ESM resolver.  Load the CJS bundle via createRequire instead.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { EAS, SchemaEncoder, SchemaRegistry } = require("@ethereum-attestation-service/eas-sdk");
import { ethers } from "ethers";
import { getEASAddresses, getSchemaUIDs, getAttestationTTLs } from "./config.js";
import { getIssuerSigner } from "./provider.js";

// ── Transaction response helpers ─────────────────────────────────────────────
// The CJS bundle loaded via createRequire may return either:
//   (a) an EAS SDK Transaction wrapper  → .tx.hash  and  .wait() returns UID string
//   (b) a raw ethers ContractTransactionResponse → .hash  and  .wait() returns receipt
// These helpers normalise both shapes.

function getTxHash(txResponse) {
  return txResponse.tx?.hash ?? txResponse.hash ?? "";
}

// EAS Attested event: Attested(address indexed, address indexed, bytes32 uid, bytes32 indexed)
// uid is the sole non-indexed field, so it lives in log.data as the first 32-byte word.
const ATTESTED_TOPIC = ethers.id(
  "Attested(address,address,bytes32,bytes32)",
);

function parseUIDFromReceipt(receipt) {
  for (const log of receipt?.logs ?? []) {
    if (log.topics?.[0] === ATTESTED_TOPIC) {
      return "0x" + log.data.slice(2, 66);
    }
  }
  throw new Error("Could not parse attestation UID from transaction receipt");
}

async function waitForUID(txResponse) {
  const result = await txResponse.wait();
  // EAS Transaction.wait() returns a UID string; ethers wait() returns a receipt object.
  return typeof result === "string" ? result : parseUIDFromReceipt(result);
}

// ── Schema definitions ───────────────────────────────────────────────────────
// These match the EAS schema strings registered on-chain.

export const SCHEMAS = {
  verifiedHuman: {
    // Asserts: this wallet belongs to a NAI-verified human.
    schema: "bool isHuman, string source",
    revocable: true,
  },
  presenceCheckpoint: {
    // Asserts: this wallet's owner passed a fresh NAI presence check.
    schema: "string source, bytes32 contextHash",
    revocable: true,
  },
};

// ── Lazy-init helpers ────────────────────────────────────────────────────────

let _eas = null;
let _registry = null;

function getEAS() {
  if (!_eas) {
    const { eas } = getEASAddresses();
    _eas = new EAS(eas);
    _eas.connect(getIssuerSigner());
  }
  return _eas;
}

function getSchemaRegistry() {
  if (!_registry) {
    const { schemaRegistry } = getEASAddresses();
    _registry = new SchemaRegistry(schemaRegistry);
    _registry.connect(getIssuerSigner());
  }
  return _registry;
}

// ── Schema registration ─────────────────────────────────────────────────────
// Only needs to run once per chain.  After registration, store the returned
// schema UIDs in env vars (EAS_VERIFIED_HUMAN_SCHEMA_UID, etc.).

export async function registerSchema(schemaString, revocable = true) {
  const registry = getSchemaRegistry();
  const tx = await registry.register({
    schema: schemaString,
    revocable,
    resolver: "0x0000000000000000000000000000000000000000", // no resolver
  });
  return waitForUID(tx);
}

export async function registerAllSchemas() {
  const results = {};
  for (const [key, def] of Object.entries(SCHEMAS)) {
    console.log(`[EAS] Registering schema "${key}": ${def.schema}`);
    const uid = await registerSchema(def.schema, def.revocable);
    results[key] = uid;
    console.log(`[EAS] Schema "${key}" registered → UID: ${uid}`);
  }
  return results;
}

// ── Attestation issuance ─────────────────────────────────────────────────────

/**
 * Issue a VerifiedHumanWallet attestation.
 *
 * @param {string} recipientAddress - Checksummed wallet address
 * @param {object} [options]
 * @param {number} [options.ttlSeconds] - Override default TTL
 * @returns {{ uid: string, txHash: string }}
 */
export async function attestVerifiedHuman(recipientAddress, options = {}) {
  const schemaUID = getSchemaUIDs().verifiedHuman;
  if (!schemaUID) {
    throw new Error(
      "EAS_VERIFIED_HUMAN_SCHEMA_UID not set. Run register-schemas.js first.",
    );
  }

  const ttl = options.ttlSeconds ?? getAttestationTTLs().verifiedHuman;
  const expirationTime = ttl > 0 ? BigInt(Math.floor(Date.now() / 1000) + ttl) : 0n;

  const encoder = new SchemaEncoder(SCHEMAS.verifiedHuman.schema);
  const encodedData = encoder.encodeData([
    { name: "isHuman", value: true, type: "bool" },
    { name: "source", value: "nai", type: "string" },
  ]);

  const eas = getEAS();
  const tx = await eas.attest({
    schema: schemaUID,
    data: {
      recipient: recipientAddress,
      expirationTime,
      revocable: true,
      data: encodedData,
    },
  });

  const txHash = getTxHash(tx);
  const uid = await waitForUID(tx);

  return { uid, txHash };
}

/**
 * Issue a PresenceCheckpoint attestation.
 *
 * @param {string} recipientAddress - Checksummed wallet address
 * @param {object} options
 * @param {string} options.source - "meet" | "telegram" | "discord" | "site" | "extension"
 * @param {string} [options.contextHash] - Optional 32-byte hex hash of session/event context
 * @param {number} [options.ttlSeconds] - Override default TTL
 * @returns {{ uid: string, txHash: string }}
 */
export async function attestPresenceCheckpoint(recipientAddress, options = {}) {
  const schemaUID = getSchemaUIDs().presenceCheckpoint;
  if (!schemaUID) {
    throw new Error(
      "EAS_PRESENCE_CHECKPOINT_SCHEMA_UID not set. Run register-schemas.js first.",
    );
  }

  const ttl = options.ttlSeconds ?? getAttestationTTLs().presenceCheckpoint;
  const expirationTime = ttl > 0 ? BigInt(Math.floor(Date.now() / 1000) + ttl) : 0n;

  // Default to zero-bytes if no context hash provided.
  const contextHash =
    options.contextHash ||
    "0x0000000000000000000000000000000000000000000000000000000000000000";

  const encoder = new SchemaEncoder(SCHEMAS.presenceCheckpoint.schema);
  const encodedData = encoder.encodeData([
    { name: "source", value: options.source || "site", type: "string" },
    { name: "contextHash", value: contextHash, type: "bytes32" },
  ]);

  const eas = getEAS();
  const tx = await eas.attest({
    schema: schemaUID,
    data: {
      recipient: recipientAddress,
      expirationTime,
      revocable: true,
      data: encodedData,
    },
  });

  const txHash = getTxHash(tx);
  const uid = await waitForUID(tx);

  return { uid, txHash };
}

// ── Revocation ───────────────────────────────────────────────────────────────

/**
 * Revoke an existing attestation on-chain.
 *
 * @param {string} schemaUID - The schema UID the attestation was issued under
 * @param {string} attestationUID - The attestation UID to revoke
 * @returns {{ txHash: string }}
 */
export async function revokeAttestation(schemaUID, attestationUID) {
  const eas = getEAS();
  const tx = await eas.revoke({
    schema: schemaUID,
    data: { uid: attestationUID },
  });
  const txHash = getTxHash(tx);
  await tx.wait();
  return { txHash };
}

// ── Query ────────────────────────────────────────────────────────────────────

/**
 * Read an attestation record from the EAS contract.
 *
 * @param {string} attestationUID
 * @returns {object} Raw attestation struct from EAS
 */
export async function getAttestation(attestationUID) {
  const eas = getEAS();
  return eas.getAttestation(attestationUID);
}
