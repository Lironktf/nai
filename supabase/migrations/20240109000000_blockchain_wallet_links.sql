-- ============================================================
-- Blockchain layer: wallet_links + attestation_records
-- Supports optional wallet linking and EAS attestations on Base.
-- No identity data goes on-chain — only wallet, timestamps, and claim type.
-- ============================================================

-- ── wallet_links ─────────────────────────────────────────────
-- Stores the binding between a verified NAI user and one or more
-- EVM wallet addresses.  Wallet linking is optional; users who
-- never connect a wallet are unaffected.

CREATE TABLE wallet_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_address  TEXT NOT NULL,            -- checksummed EVM address (0x…)
  chain_id        INTEGER NOT NULL,         -- e.g. 8453 (Base) or 84532 (Base Sepolia)
  is_primary      BOOLEAN NOT NULL DEFAULT false,
  status          TEXT NOT NULL DEFAULT 'pending_challenge'
                    CHECK (status IN ('pending_challenge', 'active', 'revoked')),
  challenge_nonce TEXT,                     -- random hex nonce for EIP-191 signing
  challenge_expires_at TIMESTAMPTZ,
  linked_at       TIMESTAMPTZ,             -- set when challenge is verified
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one primary wallet per user among active links.
CREATE UNIQUE INDEX idx_wallet_links_primary
  ON wallet_links (user_id)
  WHERE is_primary = true AND status = 'active';

-- A wallet address can only be actively linked once per chain.
CREATE UNIQUE INDEX idx_wallet_links_unique_active
  ON wallet_links (LOWER(wallet_address), chain_id)
  WHERE status = 'active';

-- Lookup by user.
CREATE INDEX idx_wallet_links_user
  ON wallet_links (user_id, status);

-- Lookup by wallet address (for external queries / attestation checks).
CREATE INDEX idx_wallet_links_wallet
  ON wallet_links (LOWER(wallet_address), chain_id);

-- Auto-update updated_at (reuse trigger function from earlier migrations if it exists).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column'
  ) THEN
    CREATE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $fn$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

CREATE TRIGGER trg_wallet_links_updated_at
  BEFORE UPDATE ON wallet_links
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ── attestation_records ──────────────────────────────────────
-- Tracks every on-chain EAS attestation issued by the NAI backend.
-- Mirrors on-chain state so the product can show status without
-- hitting an RPC node on every page load.

CREATE TABLE attestation_records (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_link_id      UUID NOT NULL REFERENCES wallet_links(id) ON DELETE CASCADE,
  attestation_uid     TEXT NOT NULL UNIQUE,  -- EAS attestation UID (bytes32 hex)
  attestation_type    TEXT NOT NULL
                        CHECK (attestation_type IN (
                          'verified_human_wallet',
                          'presence_checkpoint'
                        )),
  chain_id            INTEGER NOT NULL,
  tx_hash             TEXT NOT NULL,
  schema_uid          TEXT NOT NULL,         -- EAS schema UID used
  recipient_address   TEXT NOT NULL,         -- checksummed wallet address
  expires_at          TIMESTAMPTZ,           -- null = no expiry (until revoked)
  revoked             BOOLEAN NOT NULL DEFAULT false,
  revoked_at          TIMESTAMPTZ,
  revocation_tx_hash  TEXT,
  -- source context for presence checkpoints (meet / telegram / discord / site)
  source              TEXT,
  context_hash        TEXT,                  -- optional opaque hash for event reference
  metadata            JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_attestation_records_user
  ON attestation_records (user_id);
CREATE INDEX idx_attestation_records_wallet_link
  ON attestation_records (wallet_link_id);
CREATE INDEX idx_attestation_records_type
  ON attestation_records (attestation_type, revoked);
CREATE INDEX idx_attestation_records_recipient
  ON attestation_records (LOWER(recipient_address), chain_id);

CREATE TRIGGER trg_attestation_records_updated_at
  BEFORE UPDATE ON attestation_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
