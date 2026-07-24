import {
  S3Client,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  UploadPartCommand,
  HeadBucketCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const endpoint = process.env.AWS_ENDPOINT || undefined;

export const s3Client = new S3Client({
  region: process.env.AWS_REGION ?? 'us-east-1',
  // AWS SDK v3 defaults to attaching a CRC32 integrity checksum to uploads
  // ('WHEN_SUPPORTED'). That bakes an x-amz-checksum requirement into presigned
  // PUT URLs, so a plain client PUT (mobile app / any HTTP client) fails with
  // "Checksum Type mismatch". Only require checksums when the caller sets one.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  ...(endpoint && {
    endpoint,
    forcePathStyle: true, // Required for LocalStack
  }),
});

const BUCKET = process.env.S3_BUCKET!;
const PRESIGN_EXPIRY = 7200; // 2 hours

/**
 * Delete every object under a prefix (account deletion: uploads/{userId}/).
 * Paginates; each page deletes up to 1000 keys.
 */
export async function deletePrefix(prefix: string): Promise<number> {
  let deleted = 0;
  let continuationToken: string | undefined;
  do {
    const listed = await s3Client.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    const keys = (listed.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (keys.length > 0) {
      await s3Client.send(new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: keys },
      }));
      deleted += keys.length;
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
  return deleted;
}

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
 * Store a JSON sidecar (e.g. capture manifest) alongside a video key.
 */
export async function putJsonSidecar(videoKey: string, suffix: string, body: unknown): Promise<string> {
  const sidecarKey = videoKey.replace(/\.[^.]+$/, '') + suffix;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: sidecarKey,
      Body: JSON.stringify(body),
      ContentType: 'application/json',
    })
  );
  return sidecarKey;
}
export async function checkS3Health(): Promise<boolean> {
  if (process.env.STORAGE_DRIVER === 'local') return true; // local FS, no S3
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: BUCKET }));
    return true;
  } catch {
    return false;
  }
}
