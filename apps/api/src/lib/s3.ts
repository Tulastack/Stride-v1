import {
  S3Client,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  UploadPartCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const endpoint = process.env.AWS_ENDPOINT || undefined;

export const s3Client = new S3Client({
  region: process.env.AWS_REGION ?? 'us-east-1',
  ...(endpoint && {
    endpoint,
    forcePathStyle: true, // Required for LocalStack
  }),
});

const BUCKET = process.env.S3_BUCKET!;
const PRESIGN_EXPIRY = 7200; // 2 hours

/**
 * Initiate a multipart upload and return the uploadId
 */
export async function initiateMultipartUpload(key: string): Promise<string> {
  const command = new CreateMultipartUploadCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: 'video/mp4',
  });
  const response = await s3Client.send(command);
  if (!response.UploadId) {
    throw new Error('Failed to initiate multipart upload: no UploadId returned');
  }
  return response.UploadId;
}

/**
 * Generate presigned URLs for each part of a multipart upload
 */
export async function generatePresignedPartUrls(
  key: string,
  uploadId: string,
  numParts: number,
): Promise<{ partNumber: number; url: string }[]> {
  const parts: { partNumber: number; url: string }[] = [];

  for (let partNumber = 1; partNumber <= numParts; partNumber++) {
    const command = new UploadPartCommand({
      Bucket: BUCKET,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: PRESIGN_EXPIRY });
    parts.push({ partNumber, url });
  }

  return parts;
}

/**
 * Complete a multipart upload after all parts have been uploaded
 */
export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[],
): Promise<void> {
  const command = new CompleteMultipartUploadCommand({
    Bucket: BUCKET,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: {
      Parts: parts.map((p) => ({
        PartNumber: p.partNumber,
        ETag: p.etag,
      })),
    },
  });
  await s3Client.send(command);
}

/**
 * Health check: verify the S3 bucket is accessible
 */
export async function checkS3Health(): Promise<boolean> {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: BUCKET }));
    return true;
  } catch {
    return false;
  }
}
