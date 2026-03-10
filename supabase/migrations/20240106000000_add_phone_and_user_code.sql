-- Add phone number and short user code to users table.
-- user_code: 5-char alphanumeric, unique, generated at registration.
-- Used as a human-readable identifier for searching (e.g. "AB3K7").

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone      TEXT,
  ADD COLUMN IF NOT EXISTS user_code  TEXT UNIQUE;

-- Backfill existing users with a random code.
UPDATE users
SET user_code = UPPER(SUBSTRING(MD5(id::TEXT) FROM 1 FOR 5))
WHERE user_code IS NULL;

-- Make it non-nullable going forward (new rows always supply it).
ALTER TABLE users ALTER COLUMN user_code SET NOT NULL;

-- Fast lookup by code.
CREATE UNIQUE INDEX IF NOT EXISTS users_user_code_idx ON users (user_code);
