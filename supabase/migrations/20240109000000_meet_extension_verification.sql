ALTER TABLE meeting_participants
ADD COLUMN verification_source text
CHECK (verification_source IN ('site', 'phone', 'extension'));
