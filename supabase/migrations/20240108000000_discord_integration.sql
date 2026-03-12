CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE discord_account_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_user_id text NOT NULL UNIQUE,
  discord_username text,
  discord_channel_id text,
  discord_guild_id text,
  nai_user_id uuid REFERENCES users(id) NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE discord_verification_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_channel_id text NOT NULL,
  discord_guild_id text,
  host_user_id uuid REFERENCES users(id),
  meet_code text,
  status text NOT NULL DEFAULT 'active',
  reauth_interval_minutes integer,
  status_message_id text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE discord_session_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_session_id uuid REFERENCES discord_verification_sessions(id) ON DELETE CASCADE,
  discord_user_id text NOT NULL,
  discord_username text,
  display_name text,
  nai_user_id uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending',
  auth_code text,
  auth_code_issued_at timestamptz,
  auth_code_expires_at timestamptz,
  last_verified_at timestamptz,
  verification_expires_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(discord_session_id, discord_user_id)
);

CREATE TABLE discord_verification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_session_id uuid REFERENCES discord_verification_sessions(id) ON DELETE CASCADE,
  participant_id uuid REFERENCES discord_session_participants(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_discord_account_links_user_id ON discord_account_links(discord_user_id);
CREATE INDEX idx_discord_account_links_nai_user_id ON discord_account_links(nai_user_id);
CREATE INDEX idx_discord_sessions_channel_id ON discord_verification_sessions(discord_channel_id);
CREATE INDEX idx_discord_sessions_status ON discord_verification_sessions(status);
CREATE INDEX idx_discord_participants_session_id ON discord_session_participants(discord_session_id);
CREATE INDEX idx_discord_participants_user_id ON discord_session_participants(discord_user_id);
CREATE UNIQUE INDEX idx_discord_participants_auth_code
ON discord_session_participants(auth_code)
WHERE auth_code IS NOT NULL;

CREATE TRIGGER set_updated_at_discord_links BEFORE UPDATE ON discord_account_links FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_discord_sessions BEFORE UPDATE ON discord_verification_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_discord_participants BEFORE UPDATE ON discord_session_participants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
