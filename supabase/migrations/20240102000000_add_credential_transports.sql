-- Add transports array to webauthn_credentials so auth challenges
-- can hint which transport (usb, hybrid, internal) the credential supports.
ALTER TABLE webauthn_credentials
  ADD COLUMN IF NOT EXISTS transports TEXT[] NOT NULL DEFAULT '{}';
