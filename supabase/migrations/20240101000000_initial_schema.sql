-- ============================================================
-- TrustHandshake — Initial Schema
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. users ─────────────────────────────────────────────────
CREATE TABLE users (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 TEXT        UNIQUE NOT NULL,
  legal_name            TEXT,
  date_of_birth         DATE,
  password_hash         TEXT        NOT NULL,
  -- S3 object key for the verified profile photo extracted during enrollment
  -- Pre-sign on demand — never store a URL
  profile_photo_s3_key  TEXT,
  status                TEXT        NOT NULL DEFAULT 'pending_kyc'
                                    CHECK (status IN (
                                      'pending_kyc',
                                      'pending_video',
                                      'pending_enrollment',
                                      'pending_admin',
                                      'active',
                                      'rejected',
                                      'suspended'
                                    )),
  is_admin              BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. identity_verifications ────────────────────────────────
CREATE TABLE identity_verifications (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  persona_inquiry_id  TEXT        UNIQUE NOT NULL,
  document_type       TEXT,
  document_country    TEXT,
  face_match_score    NUMERIC(5, 2),
  liveness_score      NUMERIC(5, 2),
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN (
                                    'pending',
                                    'approved',
                                    'failed',
                                    'expired'
                                  )),
  reviewed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3. enrollment_videos ─────────────────────────────────────
-- s3_key is the S3 object key — never a URL. Pre-sign on demand (15-min expiry).
CREATE TABLE enrollment_videos (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verification_id     UUID        REFERENCES identity_verifications(id),
  s3_key              TEXT        NOT NULL,
  nonce               TEXT        NOT NULL UNIQUE,
  spoken_name_match   BOOLEAN,
  spoken_date_match   BOOLEAN,
  face_in_frame_pct   NUMERIC(5, 2),
  hand_visible_pct    NUMERIC(5, 2),
  duration_seconds    NUMERIC(8, 2),
  review_status       TEXT        NOT NULL DEFAULT 'pending_review'
                                  CHECK (review_status IN (
                                    'pending_review',
                                    'approved',
                                    'rejected'
                                  )),
  reject_reason       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 4. webauthn_credentials ──────────────────────────────────
CREATE TABLE webauthn_credentials (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id         TEXT        UNIQUE NOT NULL,
  -- CBOR-encoded public key stored as base64url
  public_key            TEXT        NOT NULL,
  sign_count            BIGINT      NOT NULL DEFAULT 0,
  status                TEXT        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN (
                                      'pending',
                                      'active',
                                      'revoked',
                                      'replacement_requested'
                                    )),
  enrollment_video_id   UUID        REFERENCES enrollment_videos(id),
  activated_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 5. verification_sessions ─────────────────────────────────
-- A verification session is the entire lifecycle of one mutual-auth request:
--   pending_acceptance → requester sent request, waiting for recipient to accept
--   awaiting_both      → both accepted, WebAuthn challenges sent, waiting for assertions
--   verified           → both assertions passed; verification_code issued
--   failed             → timeout, rejected, or assertion failure; request cancelled for both
--
-- No message relay or live session exists — verification is the terminal output.
CREATE TABLE verification_sessions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id      UUID        NOT NULL REFERENCES users(id),
  recipient_id      UUID        NOT NULL REFERENCES users(id),
  state             TEXT        NOT NULL DEFAULT 'pending_acceptance'
                                CHECK (state IN (
                                  'pending_acceptance',
                                  'awaiting_both',
                                  'verified',
                                  'failed'
                                )),
  -- Issued only when state = 'verified'. Format: TH-XXXX-XXXX
  -- Permanently stored; queryable via public GET /verify/:code
  verification_code TEXT        UNIQUE,
  -- Tracks which side has completed their WebAuthn assertion during awaiting_both
  requester_verified_at  TIMESTAMPTZ,
  recipient_verified_at  TIMESTAMPTZ,
  verified_at       TIMESTAMPTZ,   -- set when state transitions to 'verified'
  fail_reason       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT no_self_verification CHECK (requester_id <> recipient_id)
);

-- ── 6. audit_logs ────────────────────────────────────────────
-- event_type values:
--   USER_REGISTERED, KYC_APPROVED, KYC_FAILED,
--   ENROLLMENT_SUBMITTED, ENROLLMENT_APPROVED, ENROLLMENT_REJECTED,
--   VERIFICATION_REQUESTED, VERIFICATION_ACCEPTED, VERIFICATION_DECLINED,
--   VERIFICATION_CONFIRMED, VERIFICATION_FAILED,
--   CODE_QUERIED,
--   KEY_REVOKED, KEY_REPLACEMENT_REQUESTED
CREATE TABLE audit_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        REFERENCES users(id),
  event_type  TEXT        NOT NULL,
  metadata    JSONB,
  ip_address  INET,
  user_agent  TEXT,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX idx_identity_verifications_user_id       ON identity_verifications(user_id);
CREATE INDEX idx_enrollment_videos_user_id            ON enrollment_videos(user_id);
CREATE INDEX idx_enrollment_videos_review_status      ON enrollment_videos(review_status);
CREATE INDEX idx_webauthn_credentials_user_id         ON webauthn_credentials(user_id);
CREATE INDEX idx_webauthn_credentials_credential_id   ON webauthn_credentials(credential_id);
CREATE INDEX idx_verification_sessions_requester_id   ON verification_sessions(requester_id);
CREATE INDEX idx_verification_sessions_recipient_id   ON verification_sessions(recipient_id);
CREATE INDEX idx_verification_sessions_state          ON verification_sessions(state);
CREATE INDEX idx_verification_sessions_code           ON verification_sessions(verification_code);
CREATE INDEX idx_audit_logs_user_id                   ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_event_type                ON audit_logs(event_type);
CREATE INDEX idx_audit_logs_timestamp                 ON audit_logs(timestamp DESC);

-- ── Row Level Security ────────────────────────────────────────
-- RLS is disabled: the server uses the service-role key which bypasses RLS.
ALTER TABLE users                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE identity_verifications  DISABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment_videos       DISABLE ROW LEVEL SECURITY;
ALTER TABLE webauthn_credentials    DISABLE ROW LEVEL SECURITY;
ALTER TABLE verification_sessions   DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs              DISABLE ROW LEVEL SECURITY;
