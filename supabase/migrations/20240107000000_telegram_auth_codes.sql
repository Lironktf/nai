ALTER TABLE telegram_session_participants
ADD COLUMN auth_code text,
ADD COLUMN auth_code_expires_at timestamptz,
ADD COLUMN auth_code_issued_at timestamptz;

CREATE UNIQUE INDEX idx_tg_participants_auth_code
ON telegram_session_participants(auth_code)
WHERE auth_code IS NOT NULL;
