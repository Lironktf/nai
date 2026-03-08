import { Router } from 'express';
import { supabase } from '../db/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import {
  createInquiry,
  fetchInquiryDetails,
  verifyWebhookSignature,
} from '../lib/persona.js';

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
  const inquiry = event?.data?.attributes?.payload?.data;

  if (!inquiry || inquiry.type !== 'inquiry') return;

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

  if (!isApproved && !isFailed) return; // ignore in-progress events

  // Fetch detailed scores from Persona — best-effort, nulls are acceptable
  let details = { documentType: null, documentCountry: null, faceMatchScore: null, livenessScore: null };
  if (isApproved) {
    details = (await fetchInquiryDetails(inquiryId)) ?? details;
  }

  const ivStatus = isApproved ? 'approved' : 'failed';

  // Upsert the identity_verifications record.
  // ON CONFLICT (persona_inquiry_id) handles duplicate webhook deliveries.
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

  // Advance user status
  const nextUserStatus = isApproved ? 'pending_video' : 'rejected';
  await supabase
    .from('users')
    .update({ status: nextUserStatus })
    .eq('id', userId);

  // Audit log
  await supabase.from('audit_logs').insert({
    user_id: userId,
    event_type: isApproved ? 'KYC_APPROVED' : 'KYC_FAILED',
    metadata: {
      persona_inquiry_id: inquiryId,
      event_name: eventName,
      persona_status: personaStatus,
    },
  });
}

export default router;
