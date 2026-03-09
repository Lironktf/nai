import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { supabase } from '../db/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { uploadToS3 } from '../lib/s3.js';
import {
  generateEnrollmentChallenge,
  verifyEnrollmentChallenge,
  getPendingNonce,
} from '../lib/webauthn.js';

const router = Router();

// 100 MB limit — enrollment videos can be sizeable
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// POST /enroll/start
// Requires status = pending_video. Returns WebAuthn challenge options + nonce.
router.post('/start', requireAuth, async (req, res) => {
  const { userId, email } = req.user;

  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('status')
    .eq('id', userId)
    .single();

  if (userErr || !user) return res.status(404).json({ error: 'User not found' });

  if (!['pending_video', 'pending_enrollment'].includes(user.status)) {
    return res.status(409).json({
      error: 'Enrollment not available for current user status',
      status: user.status,
    });
  }

  const { options, nonce } = await generateEnrollmentChallenge(userId, email);

  await supabase.from('audit_logs').insert({
    user_id: userId,
    event_type: 'ENROLLMENT_STARTED',
    ip_address: req.ip,
    user_agent: req.headers['user-agent'],
  });

  return res.json({ challengeOptions: options, nonce });
});

// POST /enroll/video-upload
// Receives multipart: video (webm), photo (jpeg, optional), nonce (text).
// Verifies nonce matches the pending enrollment, uploads both to S3.
router.post(
  '/video-upload',
  requireAuth,
  upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'photo', maxCount: 1 },
    { name: 'fp_scan', maxCount: 1 },
  ]),
  async (req, res) => {
    const { userId } = req.user;
    const { nonce } = req.body;

    if (!nonce) return res.status(400).json({ error: 'Missing nonce' });

    const pendingNonce = getPendingNonce(userId);
    if (!pendingNonce || pendingNonce !== nonce) {
      return res.status(400).json({ error: 'Invalid or expired nonce. Restart enrollment.' });
    }

    const videoFile = req.files?.video?.[0];
    const photoFile = req.files?.photo?.[0];

    if (!videoFile) return res.status(400).json({ error: 'Missing video file' });

    try {
      // Upload enrollment video (AES-256 at rest)
      const videoKey = `enrollments/${userId}/${nonce}.webm`;
      await uploadToS3(videoKey, videoFile.buffer, 'video/webm');

      // Upload profile photo frame if captured
      if (photoFile) {
        const photoKey = `profiles/${userId}/photo.jpg`;
        await uploadToS3(photoKey, photoFile.buffer, 'image/jpeg');
      }

      // Upload fingerprint scan clip if provided
      const fpFile = req.files?.fp_scan?.[0];
      if (fpFile) {
        const fpKey = `enrollments/${userId}/${nonce}_fp.webm`;
        await uploadToS3(fpKey, fpFile.buffer, 'video/webm');
      }

      // Link to the approved identity verification for this user
      const { data: iv } = await supabase
        .from('identity_verifications')
        .select('id')
        .eq('user_id', userId)
        .eq('status', 'approved')
        .single();

      const { data: enrollmentVideo, error: evErr } = await supabase
        .from('enrollment_videos')
        .insert({
          user_id: userId,
          verification_id: iv?.id ?? null,
          s3_key: videoKey,
          nonce,
          review_status: 'pending_review',
        })
        .select('id')
        .single();

      if (evErr) {
        console.error('enrollment_videos insert error:', evErr);
        return res.status(500).json({ error: 'Failed to record enrollment video' });
      }

      // Advance user to pending_enrollment
      await supabase
        .from('users')
        .update({ status: 'pending_enrollment' })
        .eq('id', userId);

      return res.json({ enrollmentVideoId: enrollmentVideo.id });
    } catch (err) {
      console.error('S3 upload error:', err.message);
      return res.status(502).json({ error: 'Failed to upload video. Check S3 configuration.' });
    }
  }
);

// POST /enroll/webauthn-complete
// Verifies the WebAuthn registration response and stores the credential as "pending".
router.post('/webauthn-complete', requireAuth, async (req, res) => {
  const { userId } = req.user;
  const { registrationResponse, enrollmentVideoId } = req.body;

  if (!registrationResponse || !enrollmentVideoId) {
    return res.status(400).json({ error: 'Missing registrationResponse or enrollmentVideoId' });
  }

  let registrationInfo;
  try {
    registrationInfo = await verifyEnrollmentChallenge(userId, registrationResponse);
  } catch (err) {
    console.error('WebAuthn verify error:', err.message);
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
    status: 'pending',
    enrollment_video_id: enrollmentVideoId,
    transports: registrationResponse.response?.transports ?? [],
  });

  if (credErr) {
    console.error('webauthn_credentials insert error:', credErr);
    return res.status(500).json({ error: 'Failed to store credential' });
  }

  // Advance user to pending_admin (awaiting admin review)
  await supabase
    .from('users')
    .update({ status: 'pending_admin' })
    .eq('id', userId);

  await supabase.from('audit_logs').insert({
    user_id: userId,
    event_type: 'ENROLLMENT_SUBMITTED',
    metadata: { enrollment_video_id: enrollmentVideoId },
    ip_address: req.ip,
    user_agent: req.headers['user-agent'],
  });

  return res.json({ status: 'pending_admin' });
});

export default router;
