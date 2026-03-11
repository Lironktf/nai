import { Router } from 'express';
import { supabase } from '../db/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import {
  createInquiry,
  fetchInquiryDetails,
  fetchInquiryStatus,
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

// POST /kyc/sync
// Directly queries Persona's API to check if the inquiry is approved.
// Called by the mobile app after the user finishes the Persona WebView,
// as a fallback when the inquiry.approved webhook doesn't arrive (e.g. sandbox).
router.post('/sync', requireAuth, async (req, res) => {
  const { userId } = req.user;

  // Only applicable while pending KYC
  const { data: user } = await supabase
    .from('users')
    .select('status')
    .eq('id', userId)
    .single();

  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.status !== 'pending_kyc') {
    // Already past KYC — return current status
    return res.json({ status: user.status });
  }

  // Find the most recent inquiry for this user in identity_verifications
  const { data: iv } = await supabase
    .from('identity_verifications')
    .select('persona_inquiry_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!iv?.persona_inquiry_id) {
    return res.json({ status: 'pending_kyc', synced: false });
  }

  const inquiryStatus = await fetchInquiryStatus(iv.persona_inquiry_id);
  if (!inquiryStatus) {
    return res.json({ status: 'pending_kyc', synced: false });
  }

  if (inquiryStatus.isApproved) {
    const details = (await fetchInquiryDetails(iv.persona_inquiry_id)) ?? {};
    await upsertKycResult({
      userId,
      inquiryId: iv.persona_inquiry_id,
      isApproved: true,
      details,
      eventName: 'kyc.sync',
    });
    console.log(`[KYC] sync approved user ${userId} via direct Persona API check`);
    return res.json({ status: 'pending_video', synced: true });
  }

  if (inquiryStatus.isFailed) {
    await upsertKycResult({
      userId,
      inquiryId: iv.persona_inquiry_id,
      isApproved: false,
      details: {},
      eventName: 'kyc.sync',
    });
    return res.json({ status: 'rejected', synced: true });
  }

  // Still in progress (pending_review, processing, etc.)
  return res.json({ status: 'pending_kyc', synced: false, personaStatus: inquiryStatus.status });
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

  console.log(`[KYC webhook] event=${eventName} payload.type=${payload?.type}`);

  if (!payload) {
    console.log('[KYC webhook] no payload, raw event keys:', JSON.stringify(Object.keys(event?.data?.attributes ?? {})));
    return;
  }

  // Verification-level events (verification.passed, verification.failed)
  if (payload.type?.startsWith('verification/')) {
    await handleVerificationEvent(eventName, payload);
    return;
  }

  // Inquiry-level events — type may be 'inquiry' (2023 API) or 'inquiries' (newer API)
  if (payload.type === 'inquiry' || payload.type === 'inquiries') {
    await handleInquiryEvent(eventName, payload);
    return;
  }

  console.log(`[KYC webhook] unhandled payload type: ${payload.type}`);
}

async function handleVerificationEvent(eventName, verification) {
  // Individual verification events (government-id, selfie) fire mid-flow while the
  // user is still inside the Persona WebView. We record them in identity_verifications
  // but do NOT update the user status here — that only happens on inquiry.approved,
  // which fires when the FULL inquiry (both ID and face) is complete.
  const isApproved = eventName === 'verification.passed';
  const isFailed = eventName === 'verification.failed';
  if (!isApproved && !isFailed) return;

  if (!verification.type?.startsWith('verification/government-id') &&
      !verification.type?.startsWith('verification/selfie')) return;

  const details = await fetchVerificationWithInquiry(verification.id);
  if (!details?.referenceId || !details?.inquiryId) {
    console.warn('[KYC] Could not resolve userId from verification', verification.id);
    return;
  }

  const { inquiryId, referenceId: userId } = details;
  // Record in identity_verifications only — do not touch user status.
  await supabase.from('identity_verifications').upsert(
    {
      user_id: userId,
      persona_inquiry_id: inquiryId,
      document_type: details.documentType,
      document_country: details.documentCountry,
      face_match_score: details.faceMatchScore,
      liveness_score: details.livenessScore,
      status: isApproved ? 'approved' : 'failed',
      reviewed_at: new Date().toISOString(),
    },
    { onConflict: 'persona_inquiry_id' }
  );
  console.log(`[KYC] Recorded verification ${verification.id} (${eventName}) — awaiting inquiry completion`);
}

async function handleInquiryEvent(eventName, inquiry) {
  const inquiryId = inquiry.id;
  const attrs = inquiry.attributes ?? {};
  const meta = inquiry.meta ?? {};

  // Persona may use camelCase, snake_case, or kebab-case depending on API version / webhook config.
  // Also check meta object as some Persona versions put reference-id there.
  const userId =
    attrs.referenceId ??
    attrs.reference_id ??
    attrs['reference-id'] ??
    meta.referenceId ??
    meta.reference_id ??
    meta['reference-id'] ??
    null;

  const personaStatus = attrs.status;

  console.log(`[KYC inquiry] id=${inquiryId} userId=${userId} status=${personaStatus} attrs_keys=${Object.keys(attrs).join(',')} meta_keys=${Object.keys(meta).join(',')}`);
  if (!userId) {
    // Dump a truncated snapshot so we can identify the correct field name
    console.log('[KYC inquiry] FULL inquiry snapshot:', JSON.stringify(inquiry).slice(0, 800));
  }

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
  if (isApproved && details.legalName) userUpdate.legal_name = details.legalName;

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
