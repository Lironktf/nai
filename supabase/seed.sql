-- ============================================================
-- TrustHandshake — Seed Data
-- ============================================================
-- Passwords (all bcrypt cost 12):
--   admin@trusthandshake.dev  →  Admin123!
--   alice@example.com         →  Alice123!
--   bob@example.com           →  Bob123!
--
-- Alice and Bob are fully verified test users (status = active)
-- with seeded identity_verification and webauthn_credential rows.
-- Their credential public keys are placeholder values — real keys
-- are registered via the WebAuthn flow in Chunk 3.
-- ============================================================

-- ── Users ────────────────────────────────────────────────────
INSERT INTO users (id, email, legal_name, date_of_birth, password_hash, status, is_admin)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'admin@trusthandshake.dev',
    'System Administrator',
    '1990-01-01',
    '$2b$12$eImiTXuWVxfM37uY4JANjOe5sCEwMJmAMQpbFLOWB0FaxLFYJpnWi',
    'active',
    TRUE
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'alice@example.com',
    'Alice Verifier',
    '1988-05-12',
    '$2b$12$K9Oj9Lr1GmIWBr4Uz/g8v.5bCJdxpQnHLXgNHJeMXnN9P2o5LHQgG',
    'active',
    FALSE
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    'bob@example.com',
    'Bob Verifier',
    '1991-09-23',
    '$2b$12$V7Fp3oYk8zLTj5Wb6N2QUuyWh0aEIqPj4r8cXsRaFz1GLMvtKp3Cm',
    'active',
    FALSE
  )
ON CONFLICT (email) DO NOTHING;

-- ── Identity Verifications (Alice + Bob) ─────────────────────
INSERT INTO identity_verifications (
  id, user_id, persona_inquiry_id, document_type, document_country,
  face_match_score, liveness_score, status, reviewed_at
)
VALUES
  (
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000002',
    'inq_test_alice_001',
    'drivers_license',
    'US',
    98.40,
    99.10,
    'approved',
    NOW()
  ),
  (
    '10000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000003',
    'inq_test_bob_001',
    'passport',
    'US',
    97.80,
    98.50,
    'approved',
    NOW()
  )
ON CONFLICT (persona_inquiry_id) DO NOTHING;

-- ── WebAuthn Credentials (Alice + Bob — placeholder keys) ────
-- credential_id and public_key are placeholder base64url strings.
-- Replace via POST /enroll/webauthn-complete in the actual flow.
INSERT INTO webauthn_credentials (
  id, user_id, credential_id, public_key, sign_count, status, activated_at
)
VALUES
  (
    '20000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000002',
    'seed_credential_alice_001',
    'pAEDAzkBACBZAQC_placeholder_alice_public_key_base64url',
    0,
    'active',
    NOW()
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000003',
    'seed_credential_bob_001',
    'pAEDAzkBACBZAQC_placeholder_bob_public_key_base64url',
    0,
    'active',
    NOW()
  )
ON CONFLICT (credential_id) DO NOTHING;

-- ── Audit Log ────────────────────────────────────────────────
INSERT INTO audit_logs (user_id, event_type, metadata, ip_address)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'USER_REGISTERED',
    '{"source": "seed", "role": "admin"}'::jsonb,
    '127.0.0.1'
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'USER_REGISTERED',
    '{"source": "seed", "role": "test_user"}'::jsonb,
    '127.0.0.1'
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'KYC_APPROVED',
    '{"persona_inquiry_id": "inq_test_alice_001", "source": "seed"}'::jsonb,
    '127.0.0.1'
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    'USER_REGISTERED',
    '{"source": "seed", "role": "test_user"}'::jsonb,
    '127.0.0.1'
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    'KYC_APPROVED',
    '{"persona_inquiry_id": "inq_test_bob_001", "source": "seed"}'::jsonb,
    '127.0.0.1'
  );
