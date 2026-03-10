import { Router } from 'express';
import crypto from 'crypto';
import { supabase } from '../db/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { io } from '../index.js';
import { getPresignedUrl, uploadToS3 } from '../lib/s3.js';
import { createInquiry, fetchSelfiePhotoUrl } from '../lib/persona.js';
import {
  generateEnrollmentChallenge,
  verifyEnrollmentChallenge,
  generateAuthChallenge,
  verifyAuthChallenge,
  MOBILE_ORIGIN,
} from '../lib/webauthn.js';
import { compareFaces } from '../lib/rekognition.js';

const router = Router();

// ── User profile ──────────────────────────────────────────────────────────────

// GET /mobile/me
router.get('/me', requireAuth, async (req, res) => {
  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, legal_name, status, profile_photo_s3_key')
    .eq('id', req.user.userId)
    .single();

  if (error || !user) return res.status(404).json({ error: 'User not found' });

  let photoUrl = null;
  if (user.profile_photo_s3_key) {
    photoUrl = await getPresignedUrl(user.profile_photo_s3_key, 300).catch(() => null);
  }

  return res.json({
    id: user.id,
    email: user.email,
    legalName: user.legal_name,
    status: user.status,
    photoUrl,
  });
});

// ── KYC ───────────────────────────────────────────────────────────────────────

// POST /mobile/kyc/start
// Same as /kyc/start but accepted from mobile. Checks for pending_kyc status.
router.post('/kyc/start', requireAuth, async (req, res) => {
  const { userId } = req.user;

  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('status')
    .eq('id', userId)
    .single();

  if (userErr || !user) return res.status(404).json({ error: 'User not found' });
  if (user.status !== 'pending_kyc') {
    return res.status(409).json({
      error: 'KYC already completed or not required for current status',
      status: user.status,
    });
  }

  try {
    const { inquiryId, sessionToken } = await createInquiry(userId);
    return res.json({ inquiryId, sessionToken });
  } catch (err) {
    console.error('Persona createInquiry error:', err.message);
    return res.status(502).json({ error: 'Failed to initiate identity verification' });
  }
});

// ── Passkey registration (mobile enrollment) ──────────────────────────────────

// POST /mobile/passkey/register/start
// Requires status = pending_video | pending_passkey (mobile skips video step).
router.post('/passkey/register/start', requireAuth, async (req, res) => {
  const { userId, email } = req.user;

  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('status')
    .eq('id', userId)
    .single();

  if (userErr || !user) return res.status(404).json({ error: 'User not found' });

  if (!['pending_video', 'pending_passkey'].includes(user.status)) {
    return res.status(409).json({
      error: 'Passkey registration not available for current status',
      status: user.status,
    });
  }

  const { options } = await generateEnrollmentChallenge(userId, email);
  return res.json({ challengeOptions: options });
});

// POST /mobile/passkey/register/complete
router.post('/passkey/register/complete', requireAuth, async (req, res) => {
  const { userId } = req.user;
  const { registrationResponse } = req.body;

  if (!registrationResponse) {
    return res.status(400).json({ error: 'Missing registrationResponse' });
  }

  let registrationInfo;
  try {
    registrationInfo = await verifyEnrollmentChallenge(userId, registrationResponse, MOBILE_ORIGIN);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const { credential } = registrationInfo;
  const credentialId = Buffer.from(credential.id).toString('base64url');
  const publicKey = Buffer.from(credential.publicKey).toString('base64url');

  const { error: credErr } = await supabase.from('webauthn_credentials').insert({
    user_id: userId,
    credential_id: credentialId,
    public_key: publicKey,
    sign_count: credential.counter,
    status: 'active',  // mobile: no admin review needed — KYC + device biometric is sufficient
    device_type: 'mobile',
    transports: registrationResponse.response?.transports ?? [],
  });

  if (credErr) {
    console.error('webauthn_credentials insert error:', credErr);
    return res.status(500).json({ error: 'Failed to store credential' });
  }

  // Mobile users become active immediately after passkey registration.
  await supabase.from('users').update({ status: 'active' }).eq('id', userId);

  await supabase.from('audit_logs').insert({
    user_id: userId,
    event_type: 'MOBILE_PASSKEY_REGISTERED',
    ip_address: req.ip,
    user_agent: req.headers['user-agent'],
  });

  return res.json({ status: 'active' });
});

// ── Passkey assertion (during verification session) ───────────────────────────

// POST /mobile/passkey/assert/start
// Returns a WebAuthn authentication challenge tied to this session.
router.post('/passkey/assert/start', requireAuth, async (req, res) => {
  const { userId } = req.user;
  const { sessionId } = req.body;

  if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });

  // Only allow assertion if the session is in awaiting_both state.
  const { data: session } = await supabase
    .from('verification_sessions')
    .select('state, requester_id, recipient_id')
    .eq('id', sessionId)
    .single();

  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.state !== 'awaiting_both') {
    return res.status(409).json({ error: 'Session is not ready for authentication', state: session.state });
  }
  if (session.requester_id !== userId && session.recipient_id !== userId) {
    return res.status(403).json({ error: 'Not a participant in this session' });
  }

  // Get user's active mobile credentials.
  const { data: creds } = await supabase
    .from('webauthn_credentials')
    .select('credential_id, transports')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (!creds?.length) {
    return res.status(404).json({ error: 'No active passkey found. Please complete enrollment first.' });
  }

  const options = await generateAuthChallenge(userId, creds);
  return res.json({ challengeOptions: options });
});

// POST /mobile/passkey/assert/complete
// Verifies passkey + records this user's side of the verification.
// When both sides complete, transitions the session to 'verified' and generates a code.
router.post('/passkey/assert/complete', requireAuth, async (req, res) => {
  const { userId } = req.user;
  const { sessionId, assertionResponse, faceScore } = req.body;

  if (!sessionId || !assertionResponse) {
    return res.status(400).json({ error: 'Missing sessionId or assertionResponse' });
  }

  // Load session + participant check.
  const { data: session } = await supabase
    .from('verification_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.state !== 'awaiting_both') {
    return res.status(409).json({ error: 'Session is not in awaiting_both state' });
  }

  const isRequester = session.requester_id === userId;
  const isRecipient = session.recipient_id === userId;
  if (!isRequester && !isRecipient) {
    return res.status(403).json({ error: 'Not a participant in this session' });
  }

  // Don't allow double-submission.
  const alreadyVerified = isRequester
    ? session.requester_verified_at
    : session.recipient_verified_at;
  if (alreadyVerified) {
    return res.status(409).json({ error: 'Already verified for this session' });
  }

  // Load the user's active credential for verification.
  const { data: cred } = await supabase
    .from('webauthn_credentials')
    .select('credential_id, public_key, sign_count, transports')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();

  if (!cred) return res.status(404).json({ error: 'No active credential found' });

  let authInfo;
  try {
    authInfo = await verifyAuthChallenge(userId, assertionResponse, cred, MOBILE_ORIGIN);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // Update sign count (clone detection).
  await supabase
    .from('webauthn_credentials')
    .update({ sign_count: authInfo.newCounter })
    .eq('credential_id', cred.credential_id);

  const now = new Date().toISOString();
  const updateField = isRequester
    ? { requester_verified_at: now }
    : { recipient_verified_at: now };

  // Update face_match_score on the session if provided.
  if (typeof faceScore === 'number') {
    updateField.face_match_score = faceScore;
  }

  // Mark this participant's side as done.
  await supabase
    .from('verification_sessions')
    .update(updateField)
    .eq('id', sessionId);

  // Reload session to check if both sides have now verified.
  const { data: updated } = await supabase
    .from('verification_sessions')
    .select('requester_verified_at, recipient_verified_at')
    .eq('id', sessionId)
    .single();

  const bothDone = updated?.requester_verified_at && updated?.recipient_verified_at;

  if (bothDone) {
    const code = generateVerificationCode();
    await supabase
      .from('verification_sessions')
      .update({
        state: 'verified',
        verification_code: code,
        verified_at: now,
      })
      .eq('id', sessionId);

    await supabase.from('audit_logs').insert([
      {
        user_id: session.requester_id,
        event_type: 'VERIFICATION_COMPLETED',
        metadata: { session_id: sessionId, code },
      },
      {
        user_id: session.recipient_id,
        event_type: 'VERIFICATION_COMPLETED',
        metadata: { session_id: sessionId, code },
      },
    ]);
  }

  return res.json({ ok: true });
});

// ── Face embedding check ──────────────────────────────────────────────────────

// POST /mobile/face/check
// Accepts a base64 JPEG from the live camera frame.
// Compares it against the user's stored profile photo via AWS Rekognition.
// Returns { passed: boolean, score: number } where score is 0–100.
router.post('/face/check', requireAuth, async (req, res) => {
  const { userId } = req.user;
  const { sessionId, imageBase64 } = req.body;

  if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64' });

  // Get user's profile photo S3 key (populated during KYC webhook).
  const { data: user } = await supabase
    .from('users')
    .select('profile_photo_s3_key')
    .eq('id', userId)
    .single();

  if (!user?.profile_photo_s3_key) {
    return res.status(422).json({
      error: 'No reference face photo found. Please complete KYC first.',
    });
  }

  try {
    const { passed, score } = await compareFaces(user.profile_photo_s3_key, imageBase64);

    // Record the face match score on the session if provided.
    if (sessionId) {
      await supabase
        .from('verification_sessions')
        .update({ face_match_score: score })
        .eq('id', sessionId)
        .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`);
    }

    return res.json({ passed, score });
  } catch (err) {
    console.error('[face/check] error:', err.message);
    return res.status(422).json({ error: err.message, passed: false, score: 0 });
  }
});

// ── User search ───────────────────────────────────────────────────────────────

// GET /mobile/users/search?q=<query>
// Searches active users by legal_name or email. Excludes the caller.
router.get('/users/search', requireAuth, async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.json([]);

  const { data: users } = await supabase
    .from('users')
    .select('id, legal_name, profile_photo_s3_key')
    .eq('status', 'active')
    .neq('id', req.user.userId)
    .or(`legal_name.ilike.%${q}%,email.ilike.%${q}%`)
    .limit(20);

  const results = await Promise.all(
    (users ?? []).map(async (u) => ({
      id: u.id,
      legalName: u.legal_name,
      photoUrl: u.profile_photo_s3_key
        ? await getPresignedUrl(u.profile_photo_s3_key, 300).catch(() => null)
        : null,
    }))
  );

  return res.json(results);
});

// ── Verification sessions ─────────────────────────────────────────────────────

// POST /mobile/verification/request
// Creates a new verification session and notifies the recipient via Socket.io.
router.post('/verification/request', requireAuth, async (req, res) => {
  const { userId } = req.user;
  const { recipientId } = req.body;

  if (!recipientId) return res.status(400).json({ error: 'Missing recipientId' });
  if (recipientId === userId) return res.status(400).json({ error: 'Cannot verify with yourself' });

  // Confirm recipient is active.
  const { data: recipient } = await supabase
    .from('users')
    .select('id, legal_name, profile_photo_s3_key')
    .eq('id', recipientId)
    .eq('status', 'active')
    .single();

  if (!recipient) return res.status(404).json({ error: 'Recipient not found or not active' });

  const { data: session, error } = await supabase
    .from('verification_sessions')
    .insert({
      requester_id: userId,
      recipient_id: recipientId,
      state: 'pending_acceptance',
      channel: 'app',
    })
    .select('id')
    .single();

  if (error) {
    console.error('verification_sessions insert error:', error);
    return res.status(500).json({ error: 'Failed to create session' });
  }

  // Load requester info for the socket notification.
  const { data: requester } = await supabase
    .from('users')
    .select('legal_name, profile_photo_s3_key')
    .eq('id', userId)
    .single();

  const requesterPhotoUrl = requester?.profile_photo_s3_key
    ? await getPresignedUrl(requester.profile_photo_s3_key, 300).catch(() => null)
    : null;

  // Notify the recipient in real-time (they may or may not be connected).
  io.to(recipientId).emit('verification:incoming', {
    sessionId: session.id,
    requesterName: requester?.legal_name ?? 'Unknown',
    requesterPhoto: requesterPhotoUrl,
  });

  return res.json({ sessionId: session.id });
});

// POST /mobile/verification/accept
router.post('/verification/accept', requireAuth, async (req, res) => {
  const { userId } = req.user;
  const { sessionId } = req.body;

  if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });

  const { data: session } = await supabase
    .from('verification_sessions')
    .select('recipient_id, state, requester_id')
    .eq('id', sessionId)
    .single();

  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.recipient_id !== userId) return res.status(403).json({ error: 'Not the recipient' });
  if (session.state !== 'pending_acceptance') {
    return res.status(409).json({ error: 'Session is not pending acceptance' });
  }

  await supabase
    .from('verification_sessions')
    .update({ state: 'awaiting_both' })
    .eq('id', sessionId);

  // Notify the requester that the session is accepted.
  io.to(session.requester_id).emit('verification:accepted', { sessionId });

  return res.json({ ok: true });
});

// POST /mobile/verification/decline
router.post('/verification/decline', requireAuth, async (req, res) => {
  const { userId } = req.user;
  const { sessionId } = req.body;

  if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });

  const { data: session } = await supabase
    .from('verification_sessions')
    .select('recipient_id, state, requester_id')
    .eq('id', sessionId)
    .single();

  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.recipient_id !== userId) return res.status(403).json({ error: 'Not the recipient' });

  await supabase
    .from('verification_sessions')
    .update({ state: 'failed', fail_reason: 'declined' })
    .eq('id', sessionId);

  io.to(session.requester_id).emit('verification:declined', { sessionId });

  return res.json({ ok: true });
});

// GET /mobile/verification/session/:id
router.get('/verification/session/:id', requireAuth, async (req, res) => {
  const { userId } = req.user;
  const { id } = req.params;

  const { data: session } = await supabase
    .from('verification_sessions')
    .select('state, verification_code, requester_id, recipient_id, verified_at, fail_reason')
    .eq('id', id)
    .single();

  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.requester_id !== userId && session.recipient_id !== userId) {
    return res.status(403).json({ error: 'Not a participant' });
  }

  return res.json({
    state: session.state,
    verificationCode: session.verification_code ?? undefined,
    verifiedAt: session.verified_at ?? undefined,
    failReason: session.fail_reason ?? undefined,
  });
});

// GET /mobile/verification/recent
// Returns the last 20 completed verifications for the authenticated user.
router.get('/verification/recent', requireAuth, async (req, res) => {
  const { userId } = req.user;

  const { data: sessions } = await supabase
    .from('verification_sessions')
    .select(
      'id, verification_code, verified_at, requester_id, recipient_id, ' +
      'requester:requester_id(legal_name, profile_photo_s3_key), ' +
      'recipient:recipient_id(legal_name, profile_photo_s3_key)'
    )
    .eq('state', 'verified')
    .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`)
    .order('verified_at', { ascending: false })
    .limit(20);

  const results = await Promise.all(
    (sessions ?? []).map(async (s) => {
      const isPeer = s.requester_id === userId ? 'recipient' : 'requester';
      const peer = s[isPeer];
      const peerPhotoUrl = peer?.profile_photo_s3_key
        ? await getPresignedUrl(peer.profile_photo_s3_key, 300).catch(() => null)
        : null;
      return {
        id: s.id,
        peerName: peer?.legal_name ?? 'Unknown',
        peerPhotoUrl,
        verifiedAt: s.verified_at,
        code: s.verification_code,
      };
    })
  );

  return res.json(results);
});

// ── Dev-only test helpers ─────────────────────────────────────────────────────
// These routes are disabled in production (NODE_ENV=production).
// They allow a single developer to run through the full verification state
// machine without needing two real devices, or a native build.

// POST /mobile/test/sync-profile-photo
// Re-fetches the Persona selfie for the current user and uploads it to S3.
// Use this if the KYC webhook fired but the S3 upload failed (e.g. bucket didn't exist yet).
router.post('/test/sync-profile-photo', requireAuth, async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).end();

  const { userId } = req.user;

  const { data: iv } = await supabase
    .from('identity_verifications')
    .select('persona_inquiry_id')
    .eq('user_id', userId)
    .eq('status', 'approved')
    .order('reviewed_at', { ascending: false })
    .limit(1)
    .single();

  if (!iv?.persona_inquiry_id) {
    return res.status(404).json({ error: 'No approved KYC inquiry found for this user' });
  }

  const selfieUrl = await fetchSelfiePhotoUrl(iv.persona_inquiry_id);
  if (!selfieUrl) {
    return res.status(422).json({ error: `Persona returned no selfie URL for inquiry ${iv.persona_inquiry_id}` });
  }

  const imgRes = await fetch(selfieUrl);
  if (!imgRes.ok) {
    return res.status(502).json({ error: `Failed to download selfie from Persona (${imgRes.status})` });
  }

  const buffer = Buffer.from(await imgRes.arrayBuffer());
  const key = `profiles/${userId}/photo.jpg`;
  await uploadToS3(key, buffer, 'image/jpeg');
  await supabase.from('users').update({ profile_photo_s3_key: key }).eq('id', userId);

  console.log(`[dev] Synced profile photo for user ${userId} → ${key}`);
  return res.json({ ok: true, key });
});

// POST /mobile/passkey/register/bypass
// DEV ONLY: skips WebAuthn registration and marks the user as active.
// Used in Expo Go where the passkey native module is not available.
router.post('/passkey/register/bypass', requireAuth, async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).end();

  const { userId } = req.user;

  const { data: user } = await supabase
    .from('users')
    .select('status')
    .eq('id', userId)
    .single();

  if (!['pending_video', 'pending_passkey'].includes(user?.status)) {
    return res.status(409).json({ error: 'Bypass not applicable for current status', status: user?.status });
  }

  await supabase.from('users').update({ status: 'active' }).eq('id', userId);

  await supabase.from('audit_logs').insert({
    user_id: userId,
    event_type: 'MOBILE_PASSKEY_BYPASS_DEV',
    ip_address: req.ip,
    user_agent: req.headers['user-agent'],
  });

  return res.json({ status: 'active' });
});

// POST /mobile/test/start-session
// Creates a session where the caller is the requester and Alice (seed user) is
// the recipient. Alice's side auto-completes after 3 seconds, so the caller
// only needs to complete their own assertion step to see the confirmed screen.
router.post('/test/start-session', requireAuth, async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).end();

  const { userId } = req.user;
  // Alice's fixed seed ID — see supabase/seed.sql
  const ALICE_ID = '00000000-0000-0000-0000-000000000002';

  if (userId === ALICE_ID) {
    return res.status(400).json({ error: 'Log in as a non-Alice user to test.' });
  }

  const { data: session, error } = await supabase
    .from('verification_sessions')
    .insert({
      requester_id: userId,
      recipient_id: ALICE_ID,
      state: 'awaiting_both', // Alice already "accepted"
      channel: 'app',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[test] session insert error:', error);
    return res.status(500).json({ error: 'Failed to create test session' });
  }

  // After 3 s, auto-complete Alice's side. If the caller has already finished
  // by then, also finalise the session and generate the code.
  setTimeout(async () => {
    try {
      const now = new Date().toISOString();
      const { data: current } = await supabase
        .from('verification_sessions')
        .select('requester_verified_at, state')
        .eq('id', session.id)
        .single();

      if (current?.state === 'verified') return; // already done

      const update = { recipient_verified_at: now };
      if (current?.requester_verified_at) {
        const code = generateVerificationCode();
        Object.assign(update, { state: 'verified', verification_code: code, verified_at: now });
        console.log(`[test] Both sides done — code: ${code}`);
      }

      await supabase.from('verification_sessions').update(update).eq('id', session.id);
      console.log('[test] Alice auto-completed session', session.id);
    } catch (err) {
      console.error('[test] Alice auto-complete error:', err.message);
    }
  }, 3000);

  return res.json({ sessionId: session.id, peerName: 'Alice (Test)', peerPhoto: null });
});

// POST /mobile/test/assert-bypass
// Marks the caller's side of a session as verified without WebAuthn or face
// check. If both sides are now done, generates the verification code.
router.post('/test/assert-bypass', requireAuth, async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).end();

  const { userId } = req.user;
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });

  const { data: session } = await supabase
    .from('verification_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (!session) return res.status(404).json({ error: 'Session not found' });

  const isRequester = session.requester_id === userId;
  const isRecipient = session.recipient_id === userId;
  if (!isRequester && !isRecipient) return res.status(403).json({ error: 'Not a participant' });

  const now = new Date().toISOString();
  const field = isRequester ? { requester_verified_at: now } : { recipient_verified_at: now };
  await supabase.from('verification_sessions').update(field).eq('id', sessionId);

  const { data: updated } = await supabase
    .from('verification_sessions')
    .select('requester_verified_at, recipient_verified_at')
    .eq('id', sessionId)
    .single();

  if (updated?.requester_verified_at && updated?.recipient_verified_at) {
    const code = generateVerificationCode();
    await supabase
      .from('verification_sessions')
      .update({ state: 'verified', verification_code: code, verified_at: now })
      .eq('id', sessionId);
    await supabase.from('audit_logs').insert([
      { user_id: session.requester_id, event_type: 'VERIFICATION_COMPLETED', metadata: { session_id: sessionId, code } },
      { user_id: session.recipient_id, event_type: 'VERIFICATION_COMPLETED', metadata: { session_id: sessionId, code } },
    ]);
    console.log(`[test] assert-bypass finalised session ${sessionId} → ${code}`);
  }

  return res.json({ ok: true });
});

// ── Socket.io — room join ──────────────────────────────────────────────────────
// Clients should join their own userId room to receive targeted events.
// This happens automatically in index.js using socket.user.userId from the JWT.

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateVerificationCode() {
  // TH-XXXX-XXXX using unambiguous alphanumeric chars.
  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rand = (n) =>
    Array.from({ length: n }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
  return `TH-${rand(4)}-${rand(4)}`;
}

export default router;
