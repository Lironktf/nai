import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import crypto from 'crypto';

const RP_ID = process.env.RPID || 'localhost';
const RP_NAME = 'TrustHandshake';
const ORIGIN = process.env.CLIENT_URL || 'http://localhost:5173';
// Mobile passkeys use the app's associated domain as origin.
// On iOS: https://<RPID>  (set MOBILE_ORIGIN to match your Associated Domain).
export const MOBILE_ORIGIN = process.env.MOBILE_ORIGIN || ORIGIN;
export { RP_ID };

// In-memory challenge store: Map<userId, { challenge, nonce, expiresAt }>
// Fine for single-server dev. Replace with Supabase/Redis for production.
const pendingEnrollments = new Map();
// Map<userId, { challenge, expiresAt }> for authentication challenges
const pendingAuthentications = new Map();

export function generateNonce() {
  return crypto.randomUUID().replace(/-/g, '');
}

// ── Registration (enrollment) ─────────────────────────────────────────────────

export async function generateEnrollmentChallenge(userId, userEmail) {
  const nonce = generateNonce();

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: Buffer.from(userId),
    userName: userEmail,
    userDisplayName: userEmail,
    attestation: 'none',
    authenticatorSelection: {
      // Allow both platform (phone passkey, Touch ID) and cross-platform (USB key)
      // so users can enroll their phone fingerprint for cross-device auth
      userVerification: 'required',
      residentKey: 'preferred',
    },
    timeout: 120_000,
  });

  pendingEnrollments.set(userId, {
    challenge: options.challenge,
    nonce,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });

  return { options, nonce };
}

export async function verifyEnrollmentChallenge(userId, registrationResponse, expectedOrigin = ORIGIN) {
  const pending = pendingEnrollments.get(userId);
  if (!pending) throw new Error('No pending enrollment found. Please restart enrollment.');
  if (Date.now() > pending.expiresAt) {
    pendingEnrollments.delete(userId);
    throw new Error('Enrollment challenge expired. Please restart enrollment.');
  }

  const verification = await verifyRegistrationResponse({
    response: registrationResponse,
    expectedChallenge: pending.challenge,
    expectedOrigin,
    expectedRPID: RP_ID,
    requireUserVerification: true,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('WebAuthn registration verification failed.');
  }

  pendingEnrollments.delete(userId);
  return verification.registrationInfo;
}

export function getPendingNonce(userId) {
  const pending = pendingEnrollments.get(userId);
  if (!pending || Date.now() > pending.expiresAt) return null;
  return pending.nonce;
}

// ── Authentication (used in Chunk 4 — session mutual auth) ───────────────────

export async function generateAuthChallenge(userId, existingCredentials) {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'required',
    timeout: 60_000,
    allowCredentials: existingCredentials.map((c) => ({
      id: Buffer.from(c.credential_id, 'base64url'),
      type: 'public-key',
      // Include stored transports so browser can offer hybrid (QR/phone) flow
      transports: c.transports ?? ['usb', 'hybrid', 'internal'],
    })),
  });

  pendingAuthentications.set(userId, {
    challenge: options.challenge,
    expiresAt: Date.now() + 60_000,
  });

  return options;
}

export async function verifyAuthChallenge(userId, authResponse, credential, expectedOrigin = ORIGIN) {
  const pending = pendingAuthentications.get(userId);
  if (!pending) throw new Error('No pending authentication challenge.');
  if (Date.now() > pending.expiresAt) {
    pendingAuthentications.delete(userId);
    throw new Error('Authentication challenge expired.');
  }

  const verification = await verifyAuthenticationResponse({
    response: authResponse,
    expectedChallenge: pending.challenge,
    expectedOrigin,
    expectedRPID: RP_ID,
    requireUserVerification: true,
    credential: {
      id: Buffer.from(credential.credential_id, 'base64url'),
      publicKey: Buffer.from(credential.public_key, 'base64url'),
      counter: credential.sign_count,
    },
  });

  if (!verification.verified) throw new Error('Authentication verification failed.');

  pendingAuthentications.delete(userId);
  return verification.authenticationInfo;
}
