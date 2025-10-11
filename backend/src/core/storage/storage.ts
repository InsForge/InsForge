import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseManager } from '@/core/database/manager.js';
import { StorageRecord, BucketRecord } from '@/types/storage.js';
import {
  StorageFileSchema,
  UploadStrategyResponse,
  DownloadStrategyResponse,
  StorageMetadataSchema,
} from '@insforge/shared-schemas';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl as getCloudFrontSignedUrl } from '@aws-sdk/cloudfront-signer';
import logger from '@/utils/logger.js';
import { ADMIN_ID } from '@/utils/constants';
import { AppError } from '@/api/middleware/error';
import { ERROR_CODES } from '@/types/error-constants';
import { escapeSqlLikePattern, escapeRegexPattern } from '@/utils/validations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Extracted magic number constants
const ONE_HOUR_SECONDS = 3600; // 1 hour
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60; // 604800 seconds
const DEFAULT_MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10MB (10485760)
const BYTES_PER_GB = 1024 * 1024 * 1024; // For size conversions
const DEFAULT_LIST_LIMIT = 100; // Default list limit
const RANDOM_STR_START = 2; // For substring start in random string
const RANDOM_STR_END = 8; // For substring end in random string
const MAX_BASE_NAME_LENGTH = 32; // Max sanitized basename length

// Storage backend interface
interface StorageBackend {
  initialize(): void | Promise<void>;
  putObject(bucket: string, key: string, file: Express.Multer.File): Promise<void>;
  getObject(bucket: string, key: string): Promise<Buffer | null>;
  deleteObject(bucket: string, key: string): Promise<void>;
  createBucket(bucket: string): Promise<void>;
  deleteBucket(bucket: string): Promise<void>;
  // New methods for presigned URL support
  supportsPresignedUrls(): boolean;
  getUploadStrategy(
    bucket: string,
    key: string,
    metadata: { contentType?: string; size?: number }
  ): Promise<UploadStrategyResponse>;
  getDownloadStrategy(
    bucket: string,
    key: string,
    expiresIn?: number,
    isPublic?: boolean
  ): Promise<DownloadStrategyResponse>;
  verifyObjectExists(bucket: string, key: string): Promise<boolean>;
}

// Local filesystem storage implementation
class LocalStorageBackend implements StorageBackend {
  constructor(private baseDir: string) {}

  async initialize(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  private getFilePath(bucket: string, key: string): string {
    return path.join(this.baseDir, bucket, key);
  }

  async putObject(bucket: string, key: string, file: Express.Multer.File): Promise<void> {
    const filePath = this.getFilePath(bucket, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, file.buffer);
  }

  async getObject(bucket: string, key: string): Promise<Buffer | null> {
    try {
      const filePath = this.getFilePath(bucket, key);
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    try {
      const filePath = this.getFilePath(bucket, key);
      await fs.unlink(filePath);
    } catch {
      // File might not exist, continue
    }
  }

  async createBucket(bucket: string): Promise<void> {
    const bucketPath = path.join(this.baseDir, bucket);
    await fs.mkdir(bucketPath, { recursive: true });
  }

  async deleteBucket(bucket: string): Promise<void> {
    try {
      await (fs as any).rmdir(path.join(this.baseDir, bucket), { recursive: true });
    } catch {
      // Directory might not exist
    }
  }

  // Local storage doesn't support presigned URLs
  supportsPresignedUrls(): boolean {
    return false;
  }

  getUploadStrategy(
    bucket: string,
    key: string,
    _metadata: { contentType?: string; size?: number }
  ): Promise<UploadStrategyResponse> {
    // For local storage, return direct upload strategy with absolute URL
    const baseUrl = process.env.API_BASE_URL || 'http://localhost:7130';
    return Promise.resolve({
      method: 'direct',
      uploadUrl: `${baseUrl}/api/storage/buckets/${bucket}/objects/${encodeURIComponent(key)}`,
      key,
      confirmRequired: false,
    });
  }

  getDownloadStrategy(
    bucket: string,
    key: string,
    _expiresIn?: number,
    _isPublic?: boolean
  ): Promise<DownloadStrategyResponse> {
    // For local storage, return direct download URL with absolute URL
    const baseUrl = process.env.API_BASE_URL || 'http://localhost:7130';
    return Promise.resolve({
      method: 'direct',
      url: `${baseUrl}/api/storage/buckets/${bucket}/objects/${encodeURIComponent(key)}`,
    });
  }

  async verifyObjectExists(bucket: string, key: string): Promise<boolean> {
    // For local storage, check if file exists on disk
    try {
      const filePath = this.getFilePath(bucket, key);
      await fs.access(filePath);
      return true;
    } catch {
      // File doesn't exist
      return false;
    }
  }
}

// S3 storage implementation
class S3StorageBackend implements StorageBackend {
  private s3Client: S3Client | null = null;

  constructor(
    private s3Bucket: string,
    private appKey: string,
    private region: string = 'us-east-2'
  ) {}

  initialize(): void {
    // Use explicit AWS credentials if provided (local dev or self hosting)
    // Otherwise, use IAM role credentials (EC2 production)
    const s3Config: {
      region: string;
      credentials?: { accessKeyId: string; secretAccessKey: string };
    } = {
      region: this.region,
    };

    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      s3Config.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      };
    }

    this.s3Client = new S3Client(s3Config);
  }

  private getS3Key(bucket: string, key: string): string {
    return `${this.appKey}/${bucket}/${key}`;
  }

  async putObject(bucket: string, key: string, file: Express.Multer.File): Promise<void> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const s3Key = this.getS3Key(bucket, key);
    const command = new PutObjectCommand({
      Bucket: this.s3Bucket,
      Key: s3Key,
      Body: file.buffer,
      ContentType: file.mimetype || 'application/octet-stream',
    });

    try {
      await this.s3Client.send(command);
    } catch (error) {
      logger.error('S3 Upload error', {
        error: error instanceof Error ? error.message : String(error),
        bucket,
        key: s3Key,
      });
      throw error;
    }
  }

  async getObject(bucket: string, key: string): Promise<Buffer | null> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.s3Bucket,
        Key: this.getS3Key(bucket, key),
      });
      const response = await this.s3Client.send(command);
      const chunks: Uint8Array[] = [];
      // Type assertion for readable stream
      const body = response.Body as AsyncIterable<Uint8Array>;
      for await (const chunk of body) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const command = new DeleteObjectCommand({
      Bucket: this.s3Bucket,
      Key: this.getS3Key(bucket, key),
    });
    await this.s3Client.send(command);
  }

  async createBucket(_bucket: string): Promise<void> {
    // In S3 with multi-tenant, we don't create actual buckets
    // We just use folders under the app key
  }

  async deleteBucket(bucket: string): Promise<void> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    // List and delete all objects in the "bucket" (folder)
    const prefix = `${this.appKey}/${bucket}/`;
    let continuationToken: string | undefined;

    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: this.s3Bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });
      const listResponse = await this.s3Client.send(listCommand);

      if (listResponse.Contents && listResponse.Contents.length > 0) {
        const deleteCommand = new DeleteObjectsCommand({
          Bucket: this.s3Bucket,
          Delete: {
            Objects: (listResponse.Contents as { Key?: string }[])
              .filter((obj) => obj.Key !== undefined)
              .map((obj) => ({ Key: obj.Key as string })),
          },
        });
        await this.s3Client.send(deleteCommand);
      }

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);
  }

  // S3 supports presigned URLs
  supportsPresignedUrls(): boolean {
    return true;
  }

  async getUploadStrategy(
    bucket: string,
    key: string,
    metadata: { contentType?: string; size?: number }
  ): Promise<UploadStrategyResponse> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const s3Key = this.getS3Key(bucket, key);
    const expiresIn = ONE_HOUR_SECONDS; // 1 hour

    try {
      // Generate presigned POST URL for multipart form upload
      const { url, fields } = await createPresignedPost(this.s3Client, {
        Bucket: this.s3Bucket,
        Key: s3Key,
        Conditions: [
          ['content-length-range', 0, metadata.size || DEFAULT_MAX_UPLOAD_SIZE_BYTES],
        ],
        Expires: expiresIn,
      });

      return {
        method: 'presigned',
        uploadUrl: url,
        fields,
        key,
        confirmRequired: true,
        confirmUrl: `/api/storage/buckets/${bucket}/objects/${encodeURIComponent(key)}/confirm-upload`,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
      };
    } catch (error) {
      logger.error('Failed to generate presigned upload URL', {
        error: error instanceof Error ? error.message : String(error),
        bucket,
        key,
      });
      throw error;
    }
  }

  async getDownloadStrategy(
    bucket: string,
    key: string,
    expiresIn: number = ONE_HOUR_SECONDS,
    isPublic: boolean = false
  ): Promise<DownloadStrategyResponse> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const s3Key = this.getS3Key(bucket, key);
    // Public files get longer expiration (7 days), private files get shorter (1 hour default)
    const actualExpiresIn = isPublic ? SEVEN_DAYS_SECONDS : expiresIn;

    const cloudFrontUrl = process.env.AWS_CLOUDFRONT_URL;
    try {
      // If CloudFront URL is configured, use CloudFront for downloads
      if (cloudFrontUrl) {
        const cloudFrontKeyPairId = process.env.AWS_CLOUDFRONT_KEY_PAIR_ID;
        const cloudFrontPrivateKey = process.env.AWS_CLOUDFRONT_PRIVATE_KEY;
        if (!cloudFrontKeyPairId || !cloudFrontPrivateKey) {
          logger.warn(
            'CloudFront URL configured but missing key pair ID or private key, falling back to S3'
          );
        } else {
          try {
            // Generate CloudFront signed URL
            const cloudFrontObjectUrl = `${cloudFrontUrl.replace(/\/$/, '')}/${s3Key}`;
            // Convert escaped newlines to actual newlines in the private key
            const formattedPrivateKey = cloudFrontPrivateKey.replace(/\\n/g, '\n');
            // dateLessThan can be string | number | Date - using Date object directly
            const dateLessThan = new Date(Date.now() + actualExpiresIn * 1000);
            const signedUrl = getCloudFrontSignedUrl({
              url: cloudFrontObjectUrl,
              keyPairId: cloudFrontKeyPairId,
              privateKey: formattedPrivateKey,
              dateLessThan,
            });
            logger.info('CloudFront signed URL generated successfully.');
            return {
              method: 'presigned',
              url: signedUrl,
              expiresAt: dateLessThan,
            };
          } catch (cfError) {
            logger.error('Failed to generate CloudFront signed URL, falling back to S3', {
              error: cfError instanceof Error ? cfError.message : String(cfError),
              bucket,
              key,
            });
            // Fall through to S3 signed URL generation
          }
        }
      }

      // Always generate presigned URL for security in multi-tenant environment
      const command = new GetObjectCommand({
        Bucket: this.s3Bucket,
        Key: s3Key,
      });
      const url = await getSignedUrl(this.s3Client, command, { expiresIn: actualExpiresIn });
      return {
        method: 'presigned',
        url,
        expiresAt: new Date(Date.now() + actualExpiresIn * 1000),
      };
    } catch (error) {
      logger.error('Failed to generate download URL', {
        error: error instanceof Error ? error.message : String(error),
        bucket,
        key,
      });
      throw error;
    }
  }

  async verifyObjectExists(bucket: string, key: string): Promise<boolean> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const s3Key = this.getS3Key(bucket, key);
    try {
      const command = new HeadObjectCommand({
        Bucket: this.s3Bucket,
        Key: s3Key,
      });
      await this.s3Client.send(command);
      return true;
    } catch {
      return false;
    }
  }
}

export class StorageService {
  private static instance: StorageService;
  private backend: StorageBackend;

  private constructor() {
    const s3Bucket = process.env.AWS_S3_BUCKET;
    const appKey = process.env.APP_KEY || 'local';

    if (s3Bucket) {
      // Use S3 backend
      this.backend = new S3StorageBackend(s3Bucket, appKey, process.env.AWS_REGION || 'us-east-2');
    } else {
      // Use local filesystem backend
      const baseDir = process.env.STORAGE_DIR || path.join(__dirname, '../../data/storage');
      this.backend = new LocalStorageBackend(baseDir);
    }
  }

  static
