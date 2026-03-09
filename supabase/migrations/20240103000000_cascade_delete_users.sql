-- Add ON DELETE CASCADE to foreign keys that were missing it,
-- so deleting a user from the dashboard doesn't error.

ALTER TABLE audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey,
  ADD CONSTRAINT audit_logs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE verification_sessions
  DROP CONSTRAINT IF EXISTS verification_sessions_requester_id_fkey,
  ADD CONSTRAINT verification_sessions_requester_id_fkey
    FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE verification_sessions
  DROP CONSTRAINT IF EXISTS verification_sessions_recipient_id_fkey,
  ADD CONSTRAINT verification_sessions_recipient_id_fkey
    FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE;
