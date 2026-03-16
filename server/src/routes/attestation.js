// ── Attestation routes ───────────────────────────────────────────────────────
// Issue, revoke, and query EAS attestations on Base.
// The NAI backend is the sole issuer — users never write to the contract.
//
// Privacy model:
//   On-chain data contains ONLY the wallet address (as EAS recipient),
//   a boolean/string claim, timestamps, and expiry.
//   NO personal names, biometrics, or KYC details are published.

import { Router } from "express";
import { z } from "zod";
import { supabase } from "../db/supabase.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import {
  isBlockchainEnabled,
  getChainConfig,
  getSchemaUIDs,
} from "../lib/blockchain/config.js";
import {
  attestVerifiedHuman,
  attestPresenceCheckpoint,
  revokeAttestation,
} from "../lib/blockchain/eas.js";

const router = Router();

function requireBlockchain(_req, res, next) {
  if (!isBlockchainEnabled()) {
    return res
      .status(503)
      .json({ error: "Blockchain features are not enabled" });
  }
  next();
}

// ── POST /attestation/verified-human ─────────────────────────────────────────
// Issue a VerifiedHumanWallet attestation for the user's primary wallet.
// Requires: user is NAI-verified (status=active), wallet is linked.

const verifiedHumanSchema = z.object({
  walletLinkId: z.string().uuid().optional(), // defaults to primary wallet
  ttlSeconds: z.number().int().min(0).optional(),
});

router.post(
  "/verified-human",
  requireBlockchain,
  requireAuth,
  async (req, res) => {
    const parsed = verifiedHumanSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });

    const { userId } = req.user;
    const { walletLinkId, ttlSeconds } = parsed.data;

    // Verify user is active.
    const { data: user } = await supabase
      .from("users")
      .select("status")
      .eq("id", userId)
      .single();

    if (!user || user.status !== "active") {
      return res.status(403).json({
        error: "Only NAI-verified users can receive attestations",
      });
    }

    // Find the wallet.
    let walletQuery = supabase
      .from("wallet_links")
      .select("id, wallet_address, chain_id")
      .eq("user_id", userId)
      .eq("status", "active");

    if (walletLinkId) {
      walletQuery = walletQuery.eq("id", walletLinkId);
    } else {
      walletQuery = walletQuery.eq("is_primary", true);
    }

    const { data: wallet } = await walletQuery.maybeSingle();
    if (!wallet) {
      return res.status(404).json({
        error: "No active linked wallet found. Link a wallet first.",
      });
    }

    const chain = getChainConfig();
    if (wallet.chain_id !== chain.chainId) {
      return res.status(400).json({
        error: `Wallet is on chain ${wallet.chain_id}, but server is configured for ${chain.chainId}`,
      });
    }

    // Check for existing non-revoked, non-expired attestation.
    const { data: existingAttestation } = await supabase
      .from("attestation_records")
      .select("id, attestation_uid, expires_at")
      .eq("wallet_link_id", wallet.id)
      .eq("attestation_type", "verified_human_wallet")
      .eq("revoked", false)
      .maybeSingle();

    if (existingAttestation) {
      const isExpired =
        existingAttestation.expires_at &&
        new Date(existingAttestation.expires_at) < new Date();
      if (!isExpired) {
        return res.status(409).json({
          error:
            "Active VerifiedHumanWallet attestation already exists for this wallet",
          attestationUid: existingAttestation.attestation_uid,
        });
      }
    }

    // Issue on-chain.
    let result;
    try {
      result = await attestVerifiedHuman(wallet.wallet_address, { ttlSeconds });
    } catch (err) {
      console.error("[attestation/verified-human] EAS error:", err.message);
      return res
        .status(502)
        .json({ error: "Failed to issue on-chain attestation" });
    }

    const expiresAt = ttlSeconds
      ? new Date(Date.now() + ttlSeconds * 1000).toISOString()
      : null;

    // Record in DB.
    const { data: record, error: dbError } = await supabase
      .from("attestation_records")
      .insert({
        user_id: userId,
        wallet_link_id: wallet.id,
        attestation_uid: result.uid,
        attestation_type: "verified_human_wallet",
        chain_id: chain.chainId,
        tx_hash: result.txHash,
        schema_uid: getSchemaUIDs().verifiedHuman,
        recipient_address: wallet.wallet_address,
        expires_at: expiresAt,
        source: "nai",
      })
      .select("id, attestation_uid, attestation_type, tx_hash, expires_at, created_at")
      .single();

    if (dbError) {
      console.error("[attestation/verified-human] DB error:", dbError);
      // On-chain tx succeeded but DB write failed — log for manual reconciliation.
      return res.status(500).json({
        error: "Attestation issued on-chain but failed to record locally",
        attestationUid: result.uid,
        txHash: result.txHash,
      });
    }

    // Audit log.
    await supabase.from("audit_logs").insert({
      user_id: userId,
      event_type: "ATTESTATION_ISSUED",
      metadata: {
        attestation_type: "verified_human_wallet",
        attestation_uid: result.uid,
        tx_hash: result.txHash,
        wallet_address: wallet.wallet_address,
        chain_id: chain.chainId,
      },
      ip_address: req.ip,
      user_agent: req.headers["user-agent"],
    });

    return res.status(201).json({ attestation: record });
  },
);

// ── POST /attestation/presence-checkpoint ────────────────────────────────────
// Manually issue a PresenceCheckpoint (auto-issuance happens in meet/tg/discord).

const checkpointSchema = z.object({
  walletLinkId: z.string().uuid().optional(),
  source: z
    .enum(["meet", "telegram", "discord", "site", "extension"])
    .default("site"),
  contextHash: z.string().max(66).optional(),
  ttlSeconds: z.number().int().min(0).optional(),
});

router.post(
  "/presence-checkpoint",
  requireBlockchain,
  requireAuth,
  async (req, res) => {
    const parsed = checkpointSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });

    const { userId } = req.user;
    const { walletLinkId, source, contextHash, ttlSeconds } = parsed.data;

    // Verify user is active.
    const { data: user } = await supabase
      .from("users")
      .select("status")
      .eq("id", userId)
      .single();

    if (!user || user.status !== "active") {
      return res.status(403).json({
        error: "Only NAI-verified users can receive attestations",
      });
    }

    // Find wallet.
    let walletQuery = supabase
      .from("wallet_links")
      .select("id, wallet_address, chain_id")
      .eq("user_id", userId)
      .eq("status", "active");

    if (walletLinkId) {
      walletQuery = walletQuery.eq("id", walletLinkId);
    } else {
      walletQuery = walletQuery.eq("is_primary", true);
    }

    const { data: wallet } = await walletQuery.maybeSingle();
    if (!wallet) {
      return res.status(404).json({
        error: "No active linked wallet found. Link a wallet first.",
      });
    }

    const chain = getChainConfig();
    if (wallet.chain_id !== chain.chainId) {
      return res.status(400).json({
        error: `Wallet is on chain ${wallet.chain_id}, but server is configured for ${chain.chainId}`,
      });
    }

    // Issue on-chain.
    let result;
    try {
      result = await attestPresenceCheckpoint(wallet.wallet_address, {
        source,
        contextHash,
        ttlSeconds,
      });
    } catch (err) {
      console.error("[attestation/presence-checkpoint] EAS error:", err.message);
      return res
        .status(502)
        .json({ error: "Failed to issue on-chain attestation" });
    }

    const expiresAt = ttlSeconds
      ? new Date(Date.now() + ttlSeconds * 1000).toISOString()
      : null;

    const { data: record, error: dbError } = await supabase
      .from("attestation_records")
      .insert({
        user_id: userId,
        wallet_link_id: wallet.id,
        attestation_uid: result.uid,
        attestation_type: "presence_checkpoint",
        chain_id: chain.chainId,
        tx_hash: result.txHash,
        schema_uid: getSchemaUIDs().presenceCheckpoint,
        recipient_address: wallet.wallet_address,
        expires_at: expiresAt,
        source,
        context_hash: contextHash || null,
      })
      .select("id, attestation_uid, attestation_type, tx_hash, source, expires_at, created_at")
      .single();

    if (dbError) {
      console.error("[attestation/presence-checkpoint] DB error:", dbError);
      return res.status(500).json({
        error: "Attestation issued on-chain but failed to record locally",
        attestationUid: result.uid,
        txHash: result.txHash,
      });
    }

    return res.status(201).json({ attestation: record });
  },
);

// ── POST /attestation/revoke/:uid ────────────────────────────────────────────
// Revoke an attestation both on-chain and in the DB.

router.post(
  "/revoke/:uid",
  requireBlockchain,
  requireAuth,
  async (req, res) => {
    const { uid } = req.params;
    const { userId } = req.user;

    const { data: record } = await supabase
      .from("attestation_records")
      .select("*")
      .eq("attestation_uid", uid)
      .eq("user_id", userId)
      .single();

    if (!record) {
      return res.status(404).json({ error: "Attestation not found" });
    }
    if (record.revoked) {
      return res.status(400).json({ error: "Attestation already revoked" });
    }

    // Revoke on-chain.
    let txHash;
    try {
      const result = await revokeAttestation(record.schema_uid, uid);
      txHash = result.txHash;
    } catch (err) {
      console.error("[attestation/revoke] EAS error:", err.message);
      return res
        .status(502)
        .json({ error: "Failed to revoke on-chain attestation" });
    }

    // Update DB.
    await supabase
      .from("attestation_records")
      .update({
        revoked: true,
        revoked_at: new Date().toISOString(),
        revocation_tx_hash: txHash,
      })
      .eq("id", record.id);

    // Audit log.
    await supabase.from("audit_logs").insert({
      user_id: userId,
      event_type: "ATTESTATION_REVOKED",
      metadata: {
        attestation_type: record.attestation_type,
        attestation_uid: uid,
        revocation_tx_hash: txHash,
      },
      ip_address: req.ip,
      user_agent: req.headers["user-agent"],
    });

    return res.json({ ok: true, revocationTxHash: txHash });
  },
);

// ── GET /attestation/user ────────────────────────────────────────────────────
// List the authenticated user's attestation records.

router.get("/user", requireBlockchain, requireAuth, async (req, res) => {
  const { userId } = req.user;

  const { data: records, error } = await supabase
    .from("attestation_records")
    .select(
      "id, attestation_uid, attestation_type, chain_id, tx_hash, recipient_address, expires_at, revoked, revoked_at, source, created_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[attestation/user] DB error:", error);
    return res.status(500).json({ error: "Failed to fetch attestations" });
  }

  // Mark expired attestations in the response.
  const now = new Date();
  const enriched = records.map((r) => ({
    ...r,
    expired: r.expires_at ? new Date(r.expires_at) < now : false,
    active: !r.revoked && (!r.expires_at || new Date(r.expires_at) >= now),
  }));

  return res.json({ attestations: enriched });
});

// ── GET /attestation/status/:uid ─────────────────────────────────────────────
// Public endpoint — anyone can check an attestation's status.

router.get("/status/:uid", async (req, res) => {
  if (!isBlockchainEnabled()) {
    return res
      .status(503)
      .json({ error: "Blockchain features are not enabled" });
  }

  const { uid } = req.params;

  const { data: record } = await supabase
    .from("attestation_records")
    .select(
      "attestation_uid, attestation_type, chain_id, tx_hash, recipient_address, expires_at, revoked, revoked_at, source, created_at",
    )
    .eq("attestation_uid", uid)
    .single();

  if (!record) {
    return res.status(404).json({ error: "Attestation not found" });
  }

  const now = new Date();
  return res.json({
    ...record,
    expired: record.expires_at ? new Date(record.expires_at) < now : false,
    active:
      !record.revoked &&
      (!record.expires_at || new Date(record.expires_at) >= now),
  });
});

// ── POST /attestation/revoke-all-for-wallet/:walletLinkId ────────────────────
// Revoke all active attestations for a specific wallet link (used when unlinking).

router.post(
  "/revoke-all-for-wallet/:walletLinkId",
  requireBlockchain,
  requireAuth,
  async (req, res) => {
    const { walletLinkId } = req.params;
    const { userId } = req.user;

    const { data: records } = await supabase
      .from("attestation_records")
      .select("id, attestation_uid, schema_uid")
      .eq("wallet_link_id", walletLinkId)
      .eq("user_id", userId)
      .eq("revoked", false);

    if (!records || records.length === 0) {
      return res.json({ ok: true, revokedCount: 0 });
    }

    let revokedCount = 0;
    for (const record of records) {
      try {
        const { txHash } = await revokeAttestation(
          record.schema_uid,
          record.attestation_uid,
        );
        await supabase
          .from("attestation_records")
          .update({
            revoked: true,
            revoked_at: new Date().toISOString(),
            revocation_tx_hash: txHash,
          })
          .eq("id", record.id);
        revokedCount++;
      } catch (err) {
        console.error(
          `[attestation/revoke-all] Failed to revoke ${record.attestation_uid}:`,
          err.message,
        );
      }
    }

    return res.json({ ok: true, revokedCount, total: records.length });
  },
);

export default router;
