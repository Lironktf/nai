import { Router } from 'express';
import { supabase } from '../db/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import {
  createInquiry,
  fetchInquiryDetails,
  fetchVerificationWithInquiry,
  fetchSelfiePhotoUrl,
  verifyWebhookSignature,
} from '../lib/persona.js';
import { uploadToS3 } from '../lib/s3.js';

const router = Router();

// POST /kyc/start
// Creates a Persona inquiry for the authenticated user and returns
// the inquiryId + sessionToken needed to launch the Persona SDK on the client.
router.post('/start', requireAuth, async (req, res) => {
  const { userId } = req.user;

  // Confirm user is in a state where KYC makes sense
  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('status')
    .eq('id', userId)
    .single();

  if (userErr || !user) return res.status(404).json({ error: 'User not found' });

  if (!['pending_kyc'].includes(user.status)) {
    return res.status(409).json({
      error: 'KYC already completed or not applicable for current status',
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

// GET /kyc/status
// Returns the current user status so the frontend can poll after Persona completes.
router.get('/status', requireAuth, async (req, res) => {
  const { data: user, error } = await supabase
    .from('users')
    .select('status')
    .eq('id', req.user.userId)
    .single();

  if (error || !user) return res.status(404).json({ error: 'User not found' });
  return res.json({ status: user.status });
});

// POST /kyc/webhook
// Receives Persona webhook events. req.body is a raw Buffer (express.raw middleware
// is applied in index.js before express.json so signature verification works).
router.post('/webhook', async (req, res) => {
  // Always acknowledge quickly — Persona retries on non-2xx
  const signatureHeader = req.headers['persona-signature'];

  if (!verifyWebhookSignature(req.body, signatureHeader)) {
    console.warn('Persona webhook: invalid signature');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  // Respond 200 immediately; process async so Persona doesn't time out
  res.sendStatus(200);

  setImmediate(() => handleWebhookEvent(event).catch((err) =>
    console.error('Webhook processing error:', err)
  ));
});

async function handleWebhookEvent(event) {
  const eventName = event?.data?.attributes?.name;
  const payload = event?.data?.attributes?.payload?.data;

  if (!payload) return;

  // Verification-level events (verification.passed, verification.failed)
  if (payload.type?.startsWith('verification/')) {
    await handleVerificationEvent(eventName, payload);
    return;
  }

  // Inquiry-level events (inquiry.approved, inquiry.completed, etc.)
  if (payload.type === 'inquiry') {
    await handleInquiryEvent(eventName, payload);
    return;
  }
}

async function handleVerificationEvent(eventName, verification) {
  const isApproved = eventName === 'verification.passed';
  const isFailed = eventName === 'verification.failed';
  if (!isApproved && !isFailed) return;

  // Only act on government-id verifications — selfie passes alone aren't enough
  if (!verification.type?.startsWith('verification/government-id') &&
      !verification.type?.startsWith('verification/selfie')) return;

  // Fetch the parent inquiry to get the referenceId (our userId)
  const details = await fetchVerificationWithInquiry(verification.id);
  if (!details?.referenceId || !details?.inquiryId) {
    console.warn('[KYC] Could not resolve userId from verification', verification.id);
    return;
  }

  const { inquiryId, referenceId: userId } = details;
  await upsertKycResult({ userId, inquiryId, isApproved, details, eventName });
}

async function handleInquiryEvent(eventName, inquiry) {
  const inquiryId = inquiry.id;
  const attrs = inquiry.attributes ?? {};
  const userId = attrs.referenceId ?? attrs.reference_id;
  const personaStatus = attrs.status;

  if (!userId || !inquiryId) return;

  const isApproved =
    eventName === 'inquiry.approved' ||
    (eventName === 'inquiry.completed' && personaStatus === 'approved');
  const isFailed =
    eventName === 'inquiry.failed' ||
    eventName === 'inquiry.declined' ||
    (eventName === 'inquiry.completed' &&
      ['failed', 'declined', 'expired'].includes(personaStatus));

  if (!isApproved && !isFailed) return;

  let details = { documentType: null, documentCountry: null, faceMatchScore: null, livenessScore: null };
  if (isApproved) {
    details = (await fetchInquiryDetails(inquiryId)) ?? details;
  }

  await upsertKycResult({ userId, inquiryId, isApproved, details, eventName });
}

async function upsertKycResult({ userId, inquiryId, isApproved, details, eventName }) {
  const ivStatus = isApproved ? 'approved' : 'failed';

  const { error: ivError } = await supabase
    .from('identity_verifications')
    .upsert(
      {
        user_id: userId,
        persona_inquiry_id: inquiryId,
        document_type: details.documentType,
        document_country: details.documentCountry,
        face_match_score: details.faceMatchScore,
        liveness_score: details.livenessScore,
        status: ivStatus,
        reviewed_at: new Date().toISOString(),
      },
      { onConflict: 'persona_inquiry_id' }
    );

  if (ivError) {
    console.error('identity_verifications upsert error:', ivError);
    return;
  }

  const nextUserStatus = isApproved ? 'pending_video' : 'rejected';
  const userUpdate = { status: nextUserStatus };

  // On approval: download the Persona selfie and store it as the profile photo.
  // This gives us a reference face for Azure Face API comparisons at verification time.
  if (isApproved) {
    try {
      const selfieUrl = await fetchSelfiePhotoUrl(inquiryId);
      if (selfieUrl) {
        const imgRes = await fetch(selfieUrl);
        if (imgRes.ok) {
          const buffer = Buffer.from(await imgRes.arrayBuffer());
          const key = `profiles/${userId}/photo.jpg`;
          await uploadToS3(key, buffer, 'image/jpeg');
          userUpdate.profile_photo_s3_key = key;
          console.log(`[KYC] Stored Persona selfie as profile photo for user ${userId}`);
        }
      }
    } catch (err) {
      console.warn(`[KYC] Could not store selfie photo for user ${userId}:`, err.message);
    }
  }

  await supabase.from('users').update(userUpdate).eq('id', userId);

  await supabase.from('audit_logs').insert({
    user_id: userId,
    event_type: isApproved ? 'KYC_APPROVED' : 'KYC_FAILED',
    metadata: { persona_inquiry_id: inquiryId, event_name: eventName },
  });

  console.log(`[KYC] ${nextUserStatus} for user ${userId} via ${eventName}`);
}

export default router;
