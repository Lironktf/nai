-- ============================================================
-- TrustHandshake — Meet side-panel MVP schema
-- ============================================================

-- Reusable updated_at trigger helper
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── meeting_sessions ─────────────────────────────────────────
CREATE TABLE meeting_sessions (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_code             TEXT        NOT NULL,
  host_user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status                   TEXT        NOT NULL DEFAULT 'active'
                                      CHECK (status IN ('active', 'ended')),
  reauth_interval_minutes  INTEGER     CHECK (reauth_interval_minutes BETWEEN 5 AND 60),
  started_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at                 TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One active session per meeting_code
CREATE UNIQUE INDEX idx_meeting_sessions_active_code_unique
  ON meeting_sessions (meeting_code)
  WHERE status = 'active';

CREATE INDEX idx_meeting_sessions_host_user_id ON meeting_sessions(host_user_id);
CREATE INDEX idx_meeting_sessions_status ON meeting_sessions(status);
CREATE INDEX idx_meeting_sessions_started_at ON meeting_sessions(started_at DESC);

CREATE TRIGGER trg_meeting_sessions_updated_at
BEFORE UPDATE ON meeting_sessions
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ── meeting_participants ─────────────────────────────────────
CREATE TABLE meeting_participants (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_session_id      UUID        NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
  nai_user_id             UUID        REFERENCES users(id) ON DELETE SET NULL,
  display_name            TEXT,
  status                  TEXT        NOT NULL DEFAULT 'pending'
                                     CHECK (status IN ('pending', 'verified', 'expired', 'failed', 'unlinked')),
  last_verified_at        TIMESTAMPTZ,
  verification_expires_at TIMESTAMPTZ,
  failure_reason          TEXT,
  joined_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent duplicate linked participant rows for same user in same meeting.
ALTER TABLE meeting_participants
  ADD CONSTRAINT meeting_participants_session_user_unique
  UNIQUE (meeting_session_id, nai_user_id);

CREATE INDEX idx_meeting_participants_session_id ON meeting_participants(meeting_session_id);
CREATE INDEX idx_meeting_participants_status ON meeting_participants(status);
CREATE INDEX idx_meeting_participants_expires_at ON meeting_participants(verification_expires_at);

CREATE TRIGGER trg_meeting_participants_updated_at
BEFORE UPDATE ON meeting_participants
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ── meeting_verification_events ──────────────────────────────
CREATE TABLE meeting_verification_events (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_session_id      UUID        NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
  meeting_participant_id  UUID        REFERENCES meeting_participants(id) ON DELETE CASCADE,
  event_type              TEXT        NOT NULL,
  metadata                JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_meeting_events_session_id ON meeting_verification_events(meeting_session_id);
CREATE INDEX idx_meeting_events_participant_id ON meeting_verification_events(meeting_participant_id);
CREATE INDEX idx_meeting_events_created_at ON meeting_verification_events(created_at DESC);

ALTER TABLE meeting_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_participants DISABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_verification_events DISABLE ROW LEVEL SECURITY;
