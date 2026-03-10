// AWS Rekognition — face comparison.
// Uses a single CompareFaces call: profile photo from S3 (source) vs live
// selfie as raw bytes (target). No face IDs or transient state required.
//
// IAM permissions needed: AmazonRekognitionFullAccess + AmazonS3FullAccess

import { RekognitionClient, CompareFacesCommand } from '@aws-sdk/client-rekognition';

const client = new RekognitionClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

const SIMILARITY_THRESHOLD = 85; // percent (0–100)

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

  console.log('[rekognition] calling CompareFaces — bucket:', process.env.S3_BUCKET_NAME, 'key:', profilePhotoS3Key, 'region:', process.env.AWS_REGION ?? 'us-east-1');

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
