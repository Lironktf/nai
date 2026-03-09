// Azure Face API (v1.0) — face detection and comparison.
// Docs: https://learn.microsoft.com/en-us/rest/api/face/face-detection
//
// Azure faceIds are transient (24h TTL). For persistent face matching we
// re-detect from the stored profile photo on each verification request rather
// than trying to store raw embedding vectors (Azure doesn't expose them).

const API_BASE = `${process.env.AZURE_FACE_ENDPOINT}/face/v1.0`;
const API_KEY = process.env.AZURE_FACE_KEY;

const DETECT_QUERY = new URLSearchParams({
  detectionModel: 'detection_03',      // best for still/portrait images
  recognitionModel: 'recognition_04',  // highest accuracy (512-dim internally)
  returnFaceId: 'true',
  returnFaceAttributes: 'qualityForRecognition',
}).toString();

const AZURE_HEADERS = { 'Ocp-Apim-Subscription-Key': API_KEY };

// Detect the dominant face in a base64-encoded JPEG buffer.
// Returns the transient faceId (valid 24 h), or throws if no face found.
export async function detectFaceFromBase64(base64Jpeg) {
  const res = await fetch(`${API_BASE}/detect?${DETECT_QUERY}`, {
    method: 'POST',
    headers: { ...AZURE_HEADERS, 'Content-Type': 'application/octet-stream' },
    body: Buffer.from(base64Jpeg, 'base64'),
  });

  if (!res.ok) {
    throw new Error(`Azure Face detect failed (${res.status}): ${await res.text()}`);
  }

  const faces = await res.json();
  if (!faces.length) throw new Error('No face detected in image');

  const quality = faces[0].faceAttributes?.qualityForRecognition;
  if (quality === 'low') throw new Error('Face image quality too low — please use better lighting');

  return faces[0].faceId;
}

// Detect the dominant face in an image at a publicly accessible URL
// (e.g. a short-lived pre-signed S3 URL or a Persona selfie URL).
// Returns the transient faceId, or throws if no face found.
export async function detectFaceFromUrl(imageUrl) {
  const res = await fetch(`${API_BASE}/detect?${DETECT_QUERY}`, {
    method: 'POST',
    headers: { ...AZURE_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: imageUrl }),
  });

  if (!res.ok) {
    throw new Error(`Azure Face detect failed (${res.status}): ${await res.text()}`);
  }

  const faces = await res.json();
  if (!faces.length) throw new Error('No face detected in reference photo');

  return faces[0].faceId;
}

// Compare two transient faceIds (both must have been obtained within the last 24 h).
// Returns { isIdentical: boolean, confidence: number } where confidence is 0–1.
export async function verifyFaces(faceId1, faceId2) {
  const res = await fetch(`${API_BASE}/verify`, {
    method: 'POST',
    headers: { ...AZURE_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ faceId1, faceId2 }),
  });

  if (!res.ok) {
    throw new Error(`Azure Face verify failed (${res.status}): ${await res.text()}`);
  }

  return res.json(); // { isIdentical: boolean, confidence: number }
}
