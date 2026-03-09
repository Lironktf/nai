import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../db/supabase.js';
import { requireAdmin } from '../middleware/auth.js';
import { getPresignedUrl } from '../lib/s3.js';

const router = Router();

// GET /admin/enrollment-queue
// Returns all pending_review enrollments with pre-signed video/photo URLs.
router.get('/enrollment-queue', requireAdmin, async (req, res) => {
  const { data: videos, error } = await supabase
    .from('enrollment_videos')
    .select(`
      id,
      user_id,
      s3_key,
      nonce,
      spoken_name_match,
      spoken_date_match,
      face_in_frame_pct,
      hand_visible_pct,
      duration_seconds,
      created_at,
      users (
        id,
        email,
        legal_name,
        profile_photo_s3_key
      ),
      identity_verifications (
        face_match_score,
        liveness_score,
        document_type,
        document_country
      )
    `)
    .eq('review_status', 'pending_review')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('enrollment-queue query error:', error);
    return res.status(500).json({ error: 'Failed to fetch enrollment queue' });
  }

  // Pre-sign URLs (video: 15 min, profile photo: 5 min)
  const withUrls = await Promise.all(
    (videos ?? []).map(async (v) => {
      const videoUrl = v.s3_key ? await getPresignedUrl(v.s3_key, 900).catch(() => null) : null;
      const profilePhotoKey = `profiles/${v.user_id}/photo.jpg`;
      const profilePhotoUrl = await getPresignedUrl(profilePhotoKey, 300).catch(() => null);
      const fpKey = v.nonce ? `enrollments/${v.user_id}/${v.nonce}_fp.webm` : null;
      const fpScanUrl = fpKey ? await getPresignedUrl(fpKey, 900).catch(() => null) : null;
      return { ...v, videoUrl, profilePhotoUrl, fpScanUrl };
    })
  );

  return res.json(withUrls);
});

const reviewSchema = z.object({
  enrollmentVideoId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected']),
  rejectReason: z.string().optional(),
});

// POST /admin/enrollment-review
// Approves or rejects an enrollment.
// On approval: activates credential, sets user to active, stores profile_photo_s3_key.
// On rejection: reverts user to pending_video for re-enrollment.
router.post('/enrollment-review', requireAdmin, async (req, res) => {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { enrollmentVideoId, decision, rejectReason } = parsed.data;

  const { data: video } = await supabase
    .from('enrollment_videos')
    .select('id, user_id, s3_key')
    .eq('id', enrollmentVideoId)
    .single();

  if (!video) return res.status(404).json({ error: 'Enrollment video not found' });

  // Update enrollment video status
  await supabase
    .from('enrollment_videos')
    .update({ review_status: decision, reject_reason: rejectReason ?? null })
    .eq('id', enrollmentVideoId);

  if (decision === 'approved') {
    // Activate the WebAuthn credential for this enrollment
    await supabase
      .from('webauthn_credentials')
      .update({ status: 'active', activated_at: new Date().toISOString() })
      .eq('enrollment_video_id', enrollmentVideoId);

    // Store profile photo key and activate user
    const profilePhotoKey = `profiles/${video.user_id}/photo.jpg`;
    await supabase
      .from('users')
      .update({ status: 'active', profile_photo_s3_key: profilePhotoKey })
      .eq('id', video.user_id);

    await supabase.from('audit_logs').insert({
      user_id: video.user_id,
      event_type: 'ENROLLMENT_APPROVED',
      metadata: { enrollment_video_id: enrollmentVideoId },
    });
  } else {
    // Rejected — user must re-enroll
    await supabase
      .from('users')
      .update({ status: 'pending_video' })
      .eq('id', video.user_id);

    await supabase.from('audit_logs').insert({
      user_id: video.user_id,
      event_type: 'ENROLLMENT_REJECTED',
      metadata: { enrollment_video_id: enrollmentVideoId, reason: rejectReason },
    });
  }

  return res.json({ ok: true });
});

export default router;
