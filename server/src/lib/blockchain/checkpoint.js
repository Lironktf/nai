// ── Presence checkpoint auto-issuance ────────────────────────────────────────
// Called after successful verification events (Meet, Telegram, Discord).
// If the user has an active linked wallet and blockchain is enabled,
// issues a PresenceCheckpoint attestation on Base.
//
// This is fire-and-forget — attestation failure does NOT block the
// verification flow.  Errors are logged but never surfaced to the user.

import { supabase } from "../../db/supabase.js";
import { isBlockchainEnabled, getChainConfig, getSchemaUIDs } from "./config.js";
import { attestPresenceCheckpoint } from "./eas.js";

/**
 * Attempt to auto-issue a PresenceCheckpoint for a user after a verification event.
 *
 * @param {string} userId - NAI user id
 * @param {string} source - "meet" | "telegram" | "discord"
 * @param {string} [contextHash] - Optional 32-byte hex hash of session context
 * @param {number} [ttlSeconds] - Override default TTL
 */
export async function maybeIssuePresenceCheckpoint(
  userId,
  source,
  contextHash,
  ttlSeconds,
) {
  try {
    if (!isBlockchainEnabled()) return;
    if (!getSchemaUIDs().presenceCheckpoint) return;

    // Find the user's primary active wallet link.
    const { data: wallet } = await supabase
      .from("wallet_links")
      .select("id, wallet_address, chain_id")
      .eq("user_id", userId)
      .eq("status", "active")
      .eq("is_primary", true)
      .maybeSingle();

    if (!wallet) return; // no linked wallet — nothing to do

    const chain = getChainConfig();
    if (wallet.chain_id !== chain.chainId) return; // wallet on different chain

    // Issue on-chain attestation.
    const { uid, txHash } = await attestPresenceCheckpoint(
      wallet.wallet_address,
      { source, contextHash, ttlSeconds },
    );

    const expiresAt = ttlSeconds
      ? new Date(Date.now() + ttlSeconds * 1000).toISOString()
      : null;

    // Record in DB.
    await supabase.from("attestation_records").insert({
      user_id: userId,
      wallet_link_id: wallet.id,
      attestation_uid: uid,
      attestation_type: "presence_checkpoint",
      chain_id: chain.chainId,
      tx_hash: txHash,
      schema_uid: getSchemaUIDs().presenceCheckpoint,
      recipient_address: wallet.wallet_address,
      expires_at: expiresAt,
      source,
      context_hash: contextHash || null,
    });

    console.log(
      `[checkpoint] PresenceCheckpoint issued for user=${userId} wallet=${wallet.wallet_address} uid=${uid}`,
    );
  } catch (err) {
    // Never let attestation failure break the core verification flow.
    console.error(
      `[checkpoint] Failed to issue PresenceCheckpoint for user=${userId}:`,
      err.message,
    );
  }
}
