import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({ region: process.env.AWS_REGION });

// Upload a buffer to S3 with AES-256 server-side encryption.
// Returns the S3 object key.
export async function uploadToS3(key, buffer, contentType) {
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ServerSideEncryption: 'AES256',
    })
  );
  return key;
}

// Generate a pre-signed GET URL for an S3 object.
// Default expiry: 900s (15 min). Use 300s for profile photos.
export async function getPresignedUrl(key, expiresIn = 900) {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: key }),
    { expiresIn }
  );
}
