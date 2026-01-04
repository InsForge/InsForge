import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import logger from '@/utils/logger.js';
import { isCloudEnvironment } from '@/utils/environment.js';

/**
 * Validate and get S3 config bucket
 * In cloud environments, bucket is required
 * In local environments, uses default if not provided
 */
function getConfigBucket(): string {
  const bucket = process.env.AWS_CONFIG_BUCKET;

  // In cloud environments, bucket is required
  if (isCloudEnvironment()) {
    if (!bucket || !bucket.trim()) {
      throw new Error(
        'AWS_CONFIG_BUCKET environment variable is required in cloud environments. ' +
        'Please set AWS_CONFIG_BUCKET to your S3 bucket name.'
      );
    }
    return bucket.trim();
  }

  // In local environments, use default or provided value
  return bucket || 'insforge-config';
}

/**
 * Validate and get S3 config region
 * Defaults to us-east-2 if not provided
 */
function getConfigRegion(): string {
  const region = process.env.AWS_CONFIG_REGION;

  if (!region || !region.trim()) {
    // Default to us-east-2 if not provided
    logger.warn(
      'AWS_CONFIG_REGION not set, using default: us-east-2. ' +
      'Set AWS_CONFIG_REGION to override.'
    );
    return 'us-east-2';
  }

  return region.trim();
}

const CONFIG_BUCKET = getConfigBucket();
const CONFIG_REGION = getConfigRegion();

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
      bucket: CONFIG_BUCKET,
      region: CONFIG_REGION,
    });
    return null;
  }
}
