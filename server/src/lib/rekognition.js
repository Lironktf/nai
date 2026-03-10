// AWS Rekognition — face comparison + liveness detection.
//
// IAM permissions needed:
//   AmazonRekognitionFullAccess + AmazonS3FullAccess
//   (covers CompareFaces, CreateFaceLivenessSession, GetFaceLivenessSessionResults)

import {
  RekognitionClient,
  CompareFacesCommand,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
} from '@aws-sdk/client-rekognition';

const client = new RekognitionClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

const SIMILARITY_THRESHOLD = 85;   // percent (0–100) for face match
const LIVENESS_THRESHOLD   = 90;   // percent (0–100) for liveness confidence

// ── CompareFaces ──────────────────────────────────────────────────────────────
// Compare a stored profile photo (S3 key) against a live selfie (base64 JPEG).
// Returns { passed: boolean, score: number } where score is 0–100.
// Throws if Rekognition returns an error or finds no face in either image.
export async function compareFaces(profilePhotoS3Key, base64Jpeg) {
  const command = new CompareFacesCommand({
    SourceImage: {
      S3Object: {
        Bucket: process.env.S3_BUCKET_NAME,
        Name: profilePhotoS3Key,
      },
    },
    TargetImage: {
      Bytes: Buffer.from(base64Jpeg, 'base64'),
    },
    SimilarityThreshold: SIMILARITY_THRESHOLD,
    QualityFilter: 'AUTO',
  });

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Rekognition request timed out after 15s')), 15_000)
  );

  const response = await Promise.race([client.send(command), timeout]);

  // UnmatchedFaces means a face was found but similarity was below the threshold.
  // FaceMatches being empty with no UnmatchedFaces typically means no face detected.
  if (!response.FaceMatches?.length && !response.UnmatchedFaces?.length) {
    throw new Error('No face detected in one or both images');
  }

  if (!response.FaceMatches?.length) {
    return { passed: false, score: 0 };
  }

  const score = response.FaceMatches[0].Similarity ?? 0;
  return { passed: score >= SIMILARITY_THRESHOLD, score };
}

// ── Face Liveness ─────────────────────────────────────────────────────────────
// Creates a server-side liveness session. Returns the sessionId which the
// mobile FaceLivenessDetector component needs to start the challenge.
export async function createLivenessSession() {
  const command = new CreateFaceLivenessSessionCommand({
    Settings: {
      AuditImagesLimit: 0, // don't store audit images — keeps response lightweight
    },
  });
  const response = await client.send(command);
  return response.SessionId;
}

// Fetches the result of a completed liveness session and, if the user is live,
// compares the captured reference image against their stored profile photo.
// Returns { livenessConfidence, livenessPass, faceMatchPassed, faceMatchScore }.
export async function getLivenessResult(sessionId, profilePhotoS3Key) {
  const command = new GetFaceLivenessSessionResultsCommand({ SessionId: sessionId });
  const response = await client.send(command);

  if (response.Status !== 'SUCCEEDED') {
    throw new Error(`Liveness session not complete (status: ${response.Status})`);
  }

  const livenessConfidence = response.Confidence ?? 0;
  const livenessPass = livenessConfidence >= LIVENESS_THRESHOLD;

  if (!livenessPass) {
    return { livenessConfidence, livenessPass, faceMatchPassed: false, faceMatchScore: 0 };
  }

  // ReferenceImage.Bytes is the face frame captured during the liveness challenge.
  // Use it as the target for CompareFaces against the stored profile photo.
  const refBytes = response.ReferenceImage?.Bytes;
  if (!refBytes) {
    throw new Error('Liveness succeeded but no reference image was returned');
  }

  const refBase64 = Buffer.from(refBytes).toString('base64');
  const { passed: faceMatchPassed, score: faceMatchScore } = await compareFaces(
    profilePhotoS3Key,
    refBase64
  );

  return { livenessConfidence, livenessPass, faceMatchPassed, faceMatchScore };
}
