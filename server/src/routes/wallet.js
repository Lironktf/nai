// ── Wallet linking routes ────────────────────────────────────────────────────
// Optional flow: verified NAI users can link one or more EVM wallets.
// Wallet linking requires proving ownership via EIP-191 signed challenge.
//
// Privacy: no identity data is stored in or derived from wallet addresses.
// The wallet_links table binds a wallet to a NAI user_id — nothing more.

import { Router } from "express";
import { z } from "zod";
import { supabase } from "../db/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import {
  isBlockchainEnabled,
  getChainConfig,
} from "../lib/blockchain/config.js";
import {
  generateChallenge,
  verifySignature,
  checksumAddress,
  buildSignMessage,
} from "../lib/blockchain/wallet.js";

const router = Router();

// ── Middleware: ensure blockchain feature is active ───────────────────────────
function requireBlockchain(_req, res, next) {
  if (!isBlockchainEnabled()) {
    return res
      .status(503)
      .json({ error: "Blockchain features are not enabled" });
  }
  next();
}

// ── Middleware: ensure user is NAI-verified (status = 'active') ──────────────
async function requireVerifiedUser(req, res, next) {
  const { userId } = req.user;
  const { data: user, error } = await supabase
    .from("users")
    .select("status")
    .eq("id", userId)
    .single();

  if (error || !user) {
    return res.status(404).json({ error: "User not found" });
  }
  if (user.status !== "active") {
    return res
      .status(403)
      .json({ error: "Only NAI-verified users can link wallets" });
  }
  next();
}

// ── POST /wallet/challenge ───────────────────────────────────────────────────
// Generate a nonce + message for the user to sign with their wallet.
// Creates a pending wallet_link row that will be finalised on /wallet/verify.

const challengeSchema = z.object({
  walletAddress: z.string().min(42).max(42),
});

router.post(
  "/challenge",
  requireBlockchain,
  requireAuth,
  requireVerifiedUser,
  async (req, res) => {
    const parsed = challengeSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });

    let address;
    try {
      address = checksumAddress(parsed.data.walletAddress);
    } catch {
      return res.status(400).json({ error: "Invalid wallet address" });
    }

    const { userId } = req.user;
    const chain = getChainConfig();

    // Check if this wallet is already actively linked (by any user).
    const { data: existing } = await supabase
      .from("wallet_links")
      .select("id, user_id")
      .ilike("wallet_address", address)
      .eq("chain_id", chain.chainId)
      .eq("status", "active")
      .maybeSingle();

    if (existing) {
      if (existing.user_id === userId) {
        return res
          .status(409)
          .json({ error: "This wallet is already linked to your account" });
      }
      return res
        .status(409)
        .json({ error: "This wallet is already linked to another account" });
    }

    // Clean up any stale pending challenges for this user + wallet.
    await supabase
      .from("wallet_links")
      .delete()
      .eq("user_id", userId)
      .ilike("wallet_address", address)
      .eq("chain_id", chain.chainId)
      .eq("status", "pending_challenge");

    const { nonce, expiresAt } = generateChallenge();
    const message = buildSignMessage(nonce);

    const { data: link, error } = await supabase
      .from("wallet_links")
      .insert({
        user_id: userId,
        wallet_address: address,
        chain_id: chain.chainId,
        status: "pending_challenge",
        challenge_nonce: nonce,
        challenge_expires_at: expiresAt.toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      console.error("[wallet/challenge] DB error:", error);
      return res.status(500).json({ error: "Failed to create challenge" });
    }

    return res.json({
      linkId: link.id,
      message,
      nonce,
      expiresAt: expiresAt.toISOString(),
      chainId: chain.chainId,
    });
  },
);

// ── POST /wallet/verify ──────────────────────────────────────────────────────
// Submit the signed challenge to prove wallet ownership and finalise the link.

const verifySchema = z.object({
  linkId: z.string().uuid(),
  signature: z.string().min(130).max(134), // 0x + 65 bytes hex
});

router.post(
  "/verify",
  requireBlockchain,
  requireAuth,
  requireVerifiedUser,
  async (req, res) => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });

    const { linkId, signature } = parsed.data;
    const { userId } = req.user;

    // Fetch the pending challenge.
    const { data: link, error: linkError } = await supabase
      .from("wallet_links")
      .select("*")
      .eq("id", linkId)
      .eq("user_id", userId)
      .eq("status", "pending_challenge")
      .single();

    if (linkError || !link) {
      return res
        .status(404)
        .json({ error: "Challenge not found or already used" });
    }

    // Check expiry.
    if (new Date(link.challenge_expires_at) < new Date()) {
      await supabase.from("wallet_links").delete().eq("id", link.id);
      return res
        .status(410)
        .json({ error: "Challenge expired. Please request a new one." });
    }

    // Verify the signature.
    let recoveredAddress;
    try {
      recoveredAddress = verifySignature(link.challenge_nonce, signature);
    } catch {
      return res.status(400).json({ error: "Invalid signature" });
    }

    if (recoveredAddress.toLowerCase() !== link.wallet_address.toLowerCase()) {
      return res.status(400).json({
        error: "Signature does not match the wallet address",
      });
    }

    // Determine if this should be the primary wallet.
    const { count } = await supabase
      .from("wallet_links")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "active");

    const isPrimary = count === 0; // first wallet is auto-primary

    // Activate the link.
    const { data: updated, error: updateError } = await supabase
      .from("wallet_links")
      .update({
        status: "active",
        is_primary: isPrimary,
        linked_at: new Date().toISOString(),
        challenge_nonce: null, // clear sensitive data
        challenge_expires_at: null,
      })
      .eq("id", link.id)
      .select("id, wallet_address, chain_id, is_primary, status, linked_at")
      .single();

    if (updateError) {
      console.error("[wallet/verify] DB error:", updateError);
      return res.status(500).json({ error: "Failed to activate wallet link" });
    }

    // Audit log.
    await supabase.from("audit_logs").insert({
      user_id: userId,
      event_type: "WALLET_LINKED",
      metadata: {
        wallet_address: updated.wallet_address,
        chain_id: updated.chain_id,
        is_primary: updated.is_primary,
      },
      ip_address: req.ip,
      user_agent: req.headers["user-agent"],
    });

    return res.status(201).json({ wallet: updated });
  },
);

// ── GET /wallet/linked ───────────────────────────────────────────────────────
// List the authenticated user's linked wallets.

router.get("/linked", requireBlockchain, requireAuth, async (req, res) => {
  const { userId } = req.user;

  const { data: wallets, error } = await supabase
    .from("wallet_links")
    .select(
      "id, wallet_address, chain_id, is_primary, status, linked_at, revoked_at, created_at",
    )
    .eq("user_id", userId)
    .neq("status", "pending_challenge")
    .order("linked_at", { ascending: false });

  if (error) {
    console.error("[wallet/linked] DB error:", error);
    return res.status(500).json({ error: "Failed to fetch wallets" });
  }

  return res.json({ wallets });
});

// ── POST /wallet/:id/unlink ─────────────────────────────────────────────────
// Revoke (unlink) a wallet. Does NOT automatically revoke on-chain attestations
// — that is handled separately via /attestation/revoke.

router.post(
  "/:id/unlink",
  requireBlockchain,
  requireAuth,
  async (req, res) => {
    const { id } = req.params;
    const { userId } = req.user;

    const { data: wallet, error: fetchError } = await supabase
      .from("wallet_links")
      .select("id, wallet_address, chain_id, status")
      .eq("id", id)
      .eq("user_id", userId)
      .single();

    if (fetchError || !wallet) {
      return res.status(404).json({ error: "Wallet link not found" });
    }
    if (wallet.status === "revoked") {
      return res.status(400).json({ error: "Wallet is already unlinked" });
    }

    const { error: updateError } = await supabase
      .from("wallet_links")
      .update({
        status: "revoked",
        is_primary: false,
        revoked_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateError) {
      console.error("[wallet/unlink] DB error:", updateError);
      return res.status(500).json({ error: "Failed to unlink wallet" });
    }

    // Audit log.
    await supabase.from("audit_logs").insert({
      user_id: userId,
      event_type: "WALLET_UNLINKED",
      metadata: {
        wallet_address: wallet.wallet_address,
        chain_id: wallet.chain_id,
      },
      ip_address: req.ip,
      user_agent: req.headers["user-agent"],
    });

    return res.json({ ok: true });
  },
);

// ── PATCH /wallet/:id/primary ────────────────────────────────────────────────
// Set a wallet as the user's primary wallet.

router.patch(
  "/:id/primary",
  requireBlockchain,
  requireAuth,
  async (req, res) => {
    const { id } = req.params;
    const { userId } = req.user;

    const { data: wallet, error: fetchError } = await supabase
      .from("wallet_links")
      .select("id, status")
      .eq("id", id)
      .eq("user_id", userId)
      .single();

    if (fetchError || !wallet) {
      return res.status(404).json({ error: "Wallet link not found" });
    }
    if (wallet.status !== "active") {
      return res
        .status(400)
        .json({ error: "Only active wallets can be set as primary" });
    }

    // Clear existing primary.
    await supabase
      .from("wallet_links")
      .update({ is_primary: false })
      .eq("user_id", userId)
      .eq("is_primary", true);

    // Set new primary.
    const { error: updateError } = await supabase
      .from("wallet_links")
      .update({ is_primary: true })
      .eq("id", id);

    if (updateError) {
      console.error("[wallet/primary] DB error:", updateError);
      return res
        .status(500)
        .json({ error: "Failed to update primary wallet" });
    }

    return res.json({ ok: true });
  },
);

export default router;
