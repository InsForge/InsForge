import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import logger from '@/utils/logger.js';

const CONFIG_BUCKET = 'insforge-config';
const CONFIG_REGION = 'us-east-2';

let s3Client: S3Client | null = null;

/**
 * Get or create S3 client for config loading
 */
function getS3Client(): S3Client {
  if (s3Client) {
    return s3Client;
  }

  const s3Config: {
    region: string;
    credentials?: { accessKeyId: string; secretAccessKey: string };
  } = {
    region: CONFIG_REGION,
  };

  // Use explicit credentials if provided, otherwise IAM role
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    s3Config.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  }

  s3Client = new S3Client(s3Config);
  return s3Client;
}

/**
 * Fetches a JSON config file from the S3 config bucket
 * @param key - The S3 object key (e.g., 'default-ai-models.json')
 * @returns Parsed JSON content or null if fetch fails
 */
export async function fetchS3Config<T>(key: string): Promise<T | null> {
  try {
    const command = new GetObjectCommand({
      Bucket: CONFIG_BUCKET,
      Key: key,
    });

    const response = await getS3Client().send(command);
    const body = await response.Body?.transformToString();

    if (!body) {
      logger.warn(`Empty config file from S3: ${key}`);
      return null;
    }

    return JSON.parse(body) as T;
  } catch (error) {
    logger.warn(`Failed to fetch config from S3: ${key}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
