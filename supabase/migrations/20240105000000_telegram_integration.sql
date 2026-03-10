-- Telegram account links (maps Telegram user ID to NAI user ID)
CREATE TABLE telegram_account_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id text NOT NULL UNIQUE,
  telegram_username text,
  telegram_chat_id text, -- Initial chat ID where linking happened
  nai_user_id uuid REFERENCES users(id) NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Telegram verification sessions (group sessions)
CREATE TABLE telegram_verification_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_chat_id text NOT NULL,
  host_user_id uuid REFERENCES users(id),
  meet_session_id uuid, -- Optional link to a Meet session
  meet_code text, -- Optional link to a Meet code
  status text NOT NULL DEFAULT 'active', -- 'active' | 'ended'
  reauth_interval_minutes integer, -- Optional: force re-verification after X minutes
  status_message_id text, -- ID of the pinned/last status message in TG
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Telegram session participants (tracking status within a TG session)
CREATE TABLE telegram_session_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_session_id uuid REFERENCES telegram_verification_sessions(id) ON DELETE CASCADE,
  telegram_user_id text NOT NULL,
  telegram_username text,
  nai_user_id uuid REFERENCES users(id),
  display_name text,
  status text NOT NULL DEFAULT 'pending', -- 'pending' | 'verified' | 'expired' | 'failed' | 'unlinked'
  last_verified_at timestamptz,
  verification_expires_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(telegram_session_id, telegram_user_id)
);

-- Telegram verification events (audit log)
CREATE TABLE telegram_verification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_session_id uuid REFERENCES telegram_verification_sessions(id) ON DELETE CASCADE,
  participant_id uuid REFERENCES telegram_session_participants(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_tg_account_links_tg_id ON telegram_account_links(telegram_user_id);
CREATE INDEX idx_tg_account_links_nai_id ON telegram_account_links(nai_user_id);
CREATE INDEX idx_tg_sessions_chat_id ON telegram_verification_sessions(telegram_chat_id);
CREATE INDEX idx_tg_sessions_status ON telegram_verification_sessions(status);
CREATE INDEX idx_tg_participants_session_id ON telegram_session_participants(telegram_session_id);
CREATE INDEX idx_tg_participants_tg_id ON telegram_session_participants(telegram_user_id);

-- Updated at triggers
CREATE TRIGGER set_updated_at_tg_links BEFORE UPDATE ON telegram_account_links FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_tg_sessions BEFORE UPDATE ON telegram_verification_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_tg_participants BEFORE UPDATE ON telegram_session_participants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
