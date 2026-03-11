import crypto from 'crypto';

const PERSONA_BASE = 'https://withpersona.com/api/v1';

const personaHeaders = {
  Authorization: `Bearer ${process.env.PERSONA_API_KEY}`,
  'Content-Type': 'application/json',
  'Persona-Version': '2023-01-05',
  'Key-Inflection': 'camel',
};

// Create a new Persona inquiry for the given user.
// Returns { inquiryId, sessionToken }.
export async function createInquiry(userId) {
  const res = await fetch(`${PERSONA_BASE}/inquiries`, {
    method: 'POST',
    headers: personaHeaders,
    body: JSON.stringify({
      data: {
        attributes: {
          inquiryTemplateId: process.env.PERSONA_TEMPLATE_ID,
          referenceId: userId,
        },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Persona createInquiry failed (${res.status}): ${err}`);
  }

  const json = await res.json();
  return {
    inquiryId: json.data.id,
    sessionToken: json.data.attributes.sessionToken,
  };
}

// Fetch the current status of an inquiry directly from Persona's API.
// Returns { status, isApproved, isFailed } or null on failure.
export async function fetchInquiryStatus(inquiryId) {
  const res = await fetch(`${PERSONA_BASE}/inquiries/${inquiryId}`, { headers: personaHeaders });
  if (!res.ok) return null;

  const json = await res.json();
  const status = json.data?.attributes?.status ?? null;

  return {
    status,
    isApproved: status === 'approved',
    isFailed: ['failed', 'declined', 'expired'].includes(status),
  };
}

// Fetch full inquiry details after a webhook fires.
// Returns parsed fields we care about, or null on failure.
export async function fetchInquiryDetails(inquiryId) {
  const res = await fetch(
    `${PERSONA_BASE}/inquiries/${inquiryId}?include=verifications`,
    { headers: personaHeaders }
  );

  if (!res.ok) return null;

  const json = await res.json();
  const attrs = json.data?.attributes ?? {};

  // Best-effort score extraction from included verification objects.
  // Persona may nest these differently depending on template configuration.
  const verifications = json.included ?? [];
  const govId = verifications.find((v) =>
    v.type?.startsWith('verification/government-id')
  );
  const selfie = verifications.find((v) =>
    v.type?.startsWith('verification/selfie')
  );

  const gAttrs = govId?.attributes ?? {};
  const firstName = gAttrs.nameFirst ?? gAttrs.firstName ?? null;
  const lastName  = gAttrs.nameLast  ?? gAttrs.lastName  ?? null;
  const legalName = firstName && lastName ? `${firstName} ${lastName}`.trim() : (firstName ?? lastName ?? null);

  return {
    documentType: attrs.selectedDocumentType ?? null,
    documentCountry: attrs.selectedCountryCode ?? null,
    faceMatchScore:
      gAttrs.faceComparisonScore ??
      selfie?.attributes?.faceComparisonScore ??
      null,
    livenessScore: selfie?.attributes?.livenessScore ?? null,
    legalName,
  };
}

// Fetch a verification by ID, including its parent inquiry.
// Returns { inquiryId, referenceId, documentType, documentCountry,
//           faceMatchScore, livenessScore } or null on failure.
export async function fetchVerificationWithInquiry(verificationId) {
  const res = await fetch(
    `${PERSONA_BASE}/verifications/${verificationId}?include=inquiry`,
    { headers: personaHeaders }
  );
  if (!res.ok) return null;

  const json = await res.json();
  const vAttrs = json.data?.attributes ?? {};
  const inquiry = (json.included ?? []).find((i) => i.type === 'inquiry');

  return {
    inquiryId: inquiry?.id ?? null,
    referenceId: inquiry?.attributes?.referenceId ?? null,
    documentType: vAttrs.documentType ?? vAttrs.selectedDocumentType ?? null,
    documentCountry: vAttrs.countryCode ?? vAttrs.selectedCountryCode ?? null,
    faceMatchScore: vAttrs.faceComparisonScore ?? null,
    livenessScore: vAttrs.livenessScore ?? null,
  };
}

// Fetch the primary selfie photo URL from a completed inquiry.
// Persona stores selfie captures inside the included verification/selfie object.
// Returns the first available photo URL, or null if not found.
export async function fetchSelfiePhotoUrl(inquiryId) {
  const res = await fetch(
    `${PERSONA_BASE}/inquiries/${inquiryId}?include=verifications`,
    { headers: personaHeaders }
  );
  if (!res.ok) return null;

  const json = await res.json();
  const verifications = json.included ?? [];
  const selfie = verifications.find((v) => v.type?.startsWith('verification/selfie'));

  if (!selfie) return null;

  const attrs = selfie.attributes ?? {};

  // Persona may return the photo as a direct URL string OR as a nested file
  // relationship object { data: { attributes: { url } } }. Extract either.
  function extractUrl(val) {
    if (typeof val === 'string' && val.startsWith('http')) return val;
    if (val?.data?.attributes?.url) return val.data.attributes.url;
    if (val?.url) return val.url;
    return null;
  }

  const url =
    extractUrl(attrs.selfiePhotoUrl) ??
    extractUrl(attrs.photoUrls?.[0]) ??
    extractUrl(attrs.capturedPhotoUrl) ??
    extractUrl(attrs.centerPhotoUrl) ??
    null;

  if (!url) {
    console.warn('[persona] fetchSelfiePhotoUrl: no URL found. selfie attrs keys:', Object.keys(attrs));
    console.warn('[persona] selfie attrs sample:', JSON.stringify(attrs).slice(0, 500));
  }

  return url;
}

// Verify the Persona-Signature header using HMAC-SHA256.
// rawBody must be a Buffer (use express.raw() on the webhook route).
// Returns true if the signature is valid.
export function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;

  // Header format: t=<unix_ts>,v1=<hex_sig>
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => p.split('='))
  );
  const { t, v1 } = parts;
  if (!t || !v1) return false;

  const signedPayload = `${t}.${rawBody.toString('utf8')}`;
  const expected = crypto
    .createHmac('sha256', process.env.PERSONA_WEBHOOK_SECRET)
    .update(signedPayload)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(v1, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    // Buffers different lengths — invalid signature
    return false;
  }
}
