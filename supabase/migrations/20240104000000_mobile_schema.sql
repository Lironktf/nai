-- ── Mobile schema additions ──────────────────────────────────────────────────

-- face_embeddings: metadata only — actual vectors live in Qdrant.
-- qdrant_point_id is the UUID used as the point ID in the Qdrant collection.
CREATE TABLE face_embeddings (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Where this embedding came from:
  --   persona_ahead / persona_left / persona_right = extracted from Persona selfies at KYC
  --   enrollment_selfie = captured during mobile enrollment (future use)
  source_type      TEXT        NOT NULL
                               CHECK (source_type IN (
                                 'persona_ahead',
                                 'persona_left',
                                 'persona_right',
                                 'enrollment_selfie'
                               )),
  qdrant_point_id  UUID        NOT NULL UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_face_embeddings_user_id ON face_embeddings(user_id);

-- Add device_type to webauthn_credentials to distinguish mobile passkeys from web USB keys
ALTER TABLE webauthn_credentials
  ADD COLUMN IF NOT EXISTS device_type TEXT
    CHECK (device_type IN ('usb', 'ios', 'android', 'macos', 'windows', 'unknown'))
    DEFAULT 'unknown';

-- Add mobile-specific fields to verification_sessions
ALTER TABLE verification_sessions
  ADD COLUMN IF NOT EXISTS channel TEXT
    NOT NULL DEFAULT 'web'
    CHECK (channel IN ('web', 'app', 'cross')),
  ADD COLUMN IF NOT EXISTS face_match_score NUMERIC(5, 4),   -- 0.0000–1.0000 cosine similarity
  ADD COLUMN IF NOT EXISTS liveness_score   NUMERIC(5, 2);   -- Azure liveness score

-- Add pending_passkey to the allowed user statuses (mobile flow)
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_status_check;

ALTER TABLE users
  ADD CONSTRAINT users_status_check CHECK (status IN (
    'pending_kyc',
    'pending_video',       -- web enrollment path
    'pending_enrollment',  -- web enrollment path
    'pending_admin',       -- web enrollment path
    'pending_passkey',     -- mobile: KYC done, passkey not yet registered
    'active',
    'rejected',
    'suspended'
  ));

ALTER TABLE face_embeddings DISABLE ROW LEVEL SECURITY;
