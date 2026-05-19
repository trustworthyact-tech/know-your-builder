import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const globalForR2 = globalThis as unknown as { r2Client?: S3Client };

function getR2Client(): S3Client {
  if (!globalForR2.r2Client) {
    globalForR2.r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return globalForR2.r2Client;
}

const bucket = () => process.env.R2_BUCKET_CONTRACTS ?? 'kyb-contracts';

export async function uploadToR2(key: string, body: Buffer, contentType: string): Promise<void> {
  await getR2Client().send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType })
  );
}

export async function deleteFromR2(key: string): Promise<void> {
  await getR2Client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

export async function getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(
    getR2Client(),
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn }
  );
}
