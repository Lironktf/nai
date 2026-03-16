// ── Wallet signature verification ────────────────────────────────────────────
// Generates challenges and verifies EIP-191 personal_sign signatures to
// prove wallet ownership during the wallet-linking flow.

import crypto from "crypto";
import { ethers } from "ethers";

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Generate a random hex nonce and an expiry timestamp for wallet-link challenges.
 */
export function generateChallenge() {
  const nonce = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  return { nonce, expiresAt };
}

/**
 * Build the human-readable message the user signs in their wallet.
 * Follows a simple, auditable format.
 */
export function buildSignMessage(nonce) {
  return [
    "NAI TrustHandshake — Wallet Verification",
    "",
    "Sign this message to link your wallet to your NAI identity.",
    "This does NOT grant any token approvals or transfer permissions.",
    "",
    `Nonce: ${nonce}`,
  ].join("\n");
}

/**
 * Verify an EIP-191 personal_sign signature.
 * Returns the recovered checksummed address, or throws on failure.
 */
export function verifySignature(nonce, signature) {
  const message = buildSignMessage(nonce);
  const recovered = ethers.verifyMessage(message, signature);
  return ethers.getAddress(recovered); // checksummed
}

/**
 * Normalise a wallet address to its checksummed form.
 * Throws if the address is invalid.
 */
export function checksumAddress(address) {
  return ethers.getAddress(address);
}
