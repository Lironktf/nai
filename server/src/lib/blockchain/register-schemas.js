#!/usr/bin/env node
// ── One-time EAS schema registration ─────────────────────────────────────────
// Run:  node --env-file .env server/src/lib/blockchain/register-schemas.js
//
// After running, copy the printed schema UIDs into your .env file:
//   EAS_VERIFIED_HUMAN_SCHEMA_UID=0x…
//   EAS_PRESENCE_CHECKPOINT_SCHEMA_UID=0x…

import { registerAllSchemas } from "./eas.js";
import { getChainConfig, getEASAddresses } from "./config.js";
import { getIssuerAddress } from "./provider.js";

async function main() {
  const chain = getChainConfig();
  const addresses = getEASAddresses();
  const issuer = getIssuerAddress();

  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║  NAI — EAS Schema Registration                   ║");
  console.log("╚═══════════════════════════════════════════════════╝");
  console.log(`  Network:          ${chain.name} (${chain.chainId})`);
  console.log(`  RPC:              ${chain.rpcUrl}`);
  console.log(`  EAS:              ${addresses.eas}`);
  console.log(`  SchemaRegistry:   ${addresses.schemaRegistry}`);
  console.log(`  Issuer wallet:    ${issuer}`);
  console.log();

  const results = await registerAllSchemas();

  console.log();
  console.log("Add these to your .env:");
  console.log(`  EAS_VERIFIED_HUMAN_SCHEMA_UID=${results.verifiedHuman}`);
  console.log(`  EAS_PRESENCE_CHECKPOINT_SCHEMA_UID=${results.presenceCheckpoint}`);
}

main().catch((err) => {
  console.error("Schema registration failed:", err);
  process.exit(1);
});
