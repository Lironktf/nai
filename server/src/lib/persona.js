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

  return {
    documentType: attrs.selectedDocumentType ?? null,
    documentCountry: attrs.selectedCountryCode ?? null,
    faceMatchScore:
      govId?.attributes?.faceComparisonScore ??
      selfie?.attributes?.faceComparisonScore ??
      null,
    livenessScore: selfie?.attributes?.livenessScore ?? null,
  };
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
