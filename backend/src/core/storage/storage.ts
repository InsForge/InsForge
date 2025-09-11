import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseManager } from '@/core/database/database.js';
import { StorageRecord, BucketRecord } from '@/types/storage.js';
import { 
  StorageFileSchema,
  UploadStrategyResponse,
  DownloadStrategyResponse
} from '@insforge/shared-schemas';
import { MetadataService } from '@/core/metadata/metadata.js';
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
import logger from '@/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  getDownloadStrategy(bucket: string, key: string, expiresIn?: number, isPublic?: boolean): Promise<DownloadStrategyResponse>;
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
      await fs.rmdir(path.join(this.baseDir, bucket), { recursive: true });
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
    // For local storage, return direct upload strategy
    return Promise.resolve({
      method: 'direct',
      uploadUrl: `/api/storage/buckets/${bucket}/objects/${encodeURIComponent(key)}`,
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
    // For local storage, return direct download URL
    return Promise.resolve({
      method: 'direct',
      url: `/api/storage/buckets/${bucket}/objects/${encodeURIComponent(key)}`,
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
    // Priority order for credentials:
    // 1. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
    // 2. IAM roles attached to EC2 instance
    // 3. AWS credentials file
    // The SDK automatically handles this credential chain
    
    const config: any = {
      region: this.region,
    };

    // Only set credentials if environment variables are provided
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      };
    }
    // Otherwise, SDK will automatically use IAM role or ~/.aws/credentials

    this.s3Client = new S3Client(config);
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
            Objects: listResponse.Contents.filter((obj) => obj.Key !== undefined).map((obj) => ({
              Key: obj.Key as string,
            })),
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
    const expiresIn = 3600; // 1 hour

    try {
      // Generate presigned POST URL for multipart form upload
      const { url, fields } = await createPresignedPost(this.s3Client, {
        Bucket: this.s3Bucket,
        Key: s3Key,
        Conditions: [
          ['content-length-range', 0, metadata.size || 10485760], // Max 10MB by default
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
    expiresIn: number = 3600,
    isPublic: boolean = false
  ): Promise<DownloadStrategyResponse> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const s3Key = this.getS3Key(bucket, key);

    try {
      if (isPublic) {
        // For public buckets, return direct S3 URL (no presigning needed)
        const directUrl = `https://${this.s3Bucket}.s3.${this.region}.amazonaws.com/${s3Key}`;
        
        return {
          method: 'direct',
          url: directUrl,
        };
      } else {
        // For private buckets, generate presigned URL
        const command = new GetObjectCommand({
          Bucket: this.s3Bucket,
          Key: s3Key,
        });

        const url = await getSignedUrl(this.s3Client, command, { expiresIn });

        return {
          method: 'presigned',
          url,
          expiresAt: new Date(Date.now() + expiresIn * 1000),
        };
      }
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
    const appKey = process.env.APP_KEY;

    if (s3Bucket) {
      // Use S3 backend
      if (!appKey) {
        throw new Error('APP_KEY is required when using S3 storage');
      }
      this.backend = new S3StorageBackend(s3Bucket, appKey, process.env.AWS_REGION || 'us-east-2');
    } else {
      // Use local filesystem backend
      const baseDir = process.env.STORAGE_DIR || path.join(__dirname, '../../data/storage');
      this.backend = new LocalStorageBackend(baseDir);
    }
  }

  static getInstance(): StorageService {
    if (!StorageService.instance) {
      StorageService.instance = new StorageService();
    }
    return StorageService.instance;
  }

  async initialize(): Promise<void> {
    await this.backend.initialize();
  }

  private validateBucketName(bucket: string): void {
    // Simple validation: alphanumeric, hyphens, underscores
    if (!/^[a-zA-Z0-9_-]+$/.test(bucket)) {
      throw new Error('Invalid bucket name. Use only letters, numbers, hyphens, and underscores.');
    }
  }

  private validateKey(key: string): void {
    // Prevent directory traversal
    if (key.includes('..') || key.startsWith('/')) {
      throw new Error('Invalid key. Cannot use ".." or start with "/"');
    }
  }

  async putObject(
    bucket: string,
    key: string,
    file: Express.Multer.File
  ): Promise<StorageFileSchema> {
    this.validateBucketName(bucket);
    this.validateKey(key);

    const db = DatabaseManager.getInstance().getDb();

    // Check if file already exists
    const existing = await db
      .prepare('SELECT key FROM _storage WHERE bucket = ? AND key = ?')
      .get(bucket, key);

    if (existing) {
      throw new Error(`File "${key}" already exists in bucket "${bucket}"`);
    }

    // Save file using backend
    await this.backend.putObject(bucket, key, file);

    // Save metadata to database
    await db
      .prepare(
        `
      INSERT INTO _storage (bucket, key, size, mime_type)
      VALUES (?, ?, ?, ?)
    `
      )
      .run(bucket, key, file.size, file.mimetype || null);

    // Get the actual uploaded_at timestamp from database (with alias for camelCase)
    const result = (await db
      .prepare('SELECT uploaded_at as uploadedAt FROM _storage WHERE bucket = ? AND key = ?')
      .get(bucket, key)) as { uploadedAt: string } | undefined;

    if (!result) {
      throw new Error(`Failed to retrieve upload timestamp for ${bucket}/${key}`);
    }

    // Log the upload activity
    const dbManager = DatabaseManager.getInstance();
    await dbManager.logActivity('UPLOAD', `storage/${bucket}`, key, {
      size: file.size,
      mime_type: file.mimetype,
    });

    return {
      bucket,
      key,
      size: file.size,
      mimeType: file.mimetype,
      uploadedAt: result.uploadedAt,
      url: `${process.env.API_BASE_URL || 'http://localhost:7130'}/api/storage/buckets/${bucket}/objects/${encodeURIComponent(key)}`,
    };
  }

  async getObject(
    bucket: string,
    key: string
  ): Promise<{ file: Buffer; metadata: StorageFileSchema } | null> {
    this.validateBucketName(bucket);
    this.validateKey(key);

    const db = DatabaseManager.getInstance().getDb();

    const metadata = (await db
      .prepare('SELECT * FROM _storage WHERE bucket = ? AND key = ?')
      .get(bucket, key)) as StorageRecord | undefined;

    if (!metadata) {
      return null;
    }

    const file = await this.backend.getObject(bucket, key);
    if (!file) {
      return null;
    }

    return {
      file,
      metadata: {
        key: metadata.key,
        bucket: metadata.bucket,
        size: metadata.size,
        mimeType: metadata.mime_type,
        uploadedAt: metadata.uploaded_at,
        url: `${process.env.API_BASE_URL || 'http://localhost:7130'}/api/storage/buckets/${bucket}/objects/${encodeURIComponent(key)}`,
      },
    };
  }

  async deleteObject(bucket: string, key: string): Promise<boolean> {
    this.validateBucketName(bucket);
    this.validateKey(key);

    const db = DatabaseManager.getInstance().getDb();

    // Delete file using backend
    await this.backend.deleteObject(bucket, key);

    // Get file info before deletion for logging
    const fileInfo = (await db
      .prepare('SELECT * FROM _storage WHERE bucket = ? AND key = ?')
      .get(bucket, key)) as StorageRecord | undefined;

    // Delete from database
    const result = await db
      .prepare('DELETE FROM _storage WHERE bucket = ? AND key = ?')
      .run(bucket, key);

    if (result.changes > 0 && fileInfo) {
      // Log the deletion activity
      const dbManager = DatabaseManager.getInstance();
      await dbManager.logActivity('DELETE', `storage/${bucket}`, key, {
        size: fileInfo.size,
        mime_type: fileInfo.mime_type,
      });
    }

    return result.changes > 0;
  }

  async listObjects(
    bucket: string,
    prefix?: string,
    limit: number = 100,
    offset: number = 0,
    searchQuery?: string
  ): Promise<{ objects: StorageFileSchema[]; total: number }> {
    this.validateBucketName(bucket);

    const db = DatabaseManager.getInstance().getDb();

    let query = 'SELECT * FROM _storage WHERE bucket = ?';
    let countQuery = 'SELECT COUNT(*) as count FROM _storage WHERE bucket = ?';
    const params: (string | number)[] = [bucket];

    if (prefix) {
      query += ' AND key LIKE ?';
      countQuery += ' AND key LIKE ?';
      params.push(`${prefix}%`);
    }

    // Add search functionality for file names (key field)
    if (searchQuery && searchQuery.trim()) {
      query += ' AND key LIKE ?';
      countQuery += ' AND key LIKE ?';
      const searchPattern = `%${searchQuery.trim()}%`;
      params.push(searchPattern);
    }

    query += ' ORDER BY key LIMIT ? OFFSET ?';
    const queryParams = [...params, limit, offset];

    const objects = await db.prepare(query).all(...queryParams);
    const total = ((await db.prepare(countQuery).get(...params)) as { count: number }).count;

    return {
      objects: objects.map((obj) => ({
        ...obj,
        mimeType: obj.mime_type,
        uploadedAt: obj.uploaded_at,
        url: `${process.env.API_BASE_URL || 'http://localhost:7130'}/api/storage/buckets/${bucket}/objects/${encodeURIComponent(obj.key)}`,
      })),
      total,
    };
  }

  async isBucketPublic(bucket: string): Promise<boolean> {
    const db = DatabaseManager.getInstance().getDb();
    const result = (await db
      .prepare('SELECT public FROM _storage_buckets WHERE name = ?')
      .get(bucket)) as Pick<BucketRecord, 'public'> | undefined;
    return result?.public || false;
  }

  async updateBucketVisibility(bucket: string, isPublic: boolean): Promise<void> {
    const db = DatabaseManager.getInstance().getDb();

    // Check if bucket exists
    const bucketExists = await db
      .prepare('SELECT name FROM _storage_buckets WHERE name = ?')
      .get(bucket);

    if (!bucketExists) {
      throw new Error(`Bucket "${bucket}" does not exist`);
    }

    // Update bucket visibility in _storage_buckets table
    await db
      .prepare(
        'UPDATE _storage_buckets SET public = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?'
      )
      .run(isPublic, bucket);

    // Log visibility change
    const dbManager = DatabaseManager.getInstance();
    await dbManager.logActivity('UPDATE', 'storage', bucket, {
      type: 'bucket_visibility',
      public: isPublic,
    });

    // Update storage metadata
    await MetadataService.getInstance().updateStorageMetadata();
  }

  async listBuckets(): Promise<string[]> {
    const db = DatabaseManager.getInstance().getDb();

    // Get all buckets from _storage_buckets table
    const buckets = (await db
      .prepare('SELECT name FROM _storage_buckets ORDER BY name')
      .all()) as Pick<BucketRecord, 'name'>[];

    return buckets.map((b) => b.name);
  }

  async createBucket(bucket: string, isPublic: boolean = true): Promise<void> {
    this.validateBucketName(bucket);

    const db = DatabaseManager.getInstance().getDb();

    // Check if bucket already exists
    const existing = await db
      .prepare('SELECT name FROM _storage_buckets WHERE name = ?')
      .get(bucket);

    if (existing) {
      throw new Error(`Bucket "${bucket}" already exists`);
    }

    // Insert bucket into _storage_buckets table
    await db
      .prepare('INSERT INTO _storage_buckets (name, public) VALUES (?, ?)')
      .run(bucket, isPublic);

    // Create bucket using backend
    await this.backend.createBucket(bucket);

    // Log bucket creation
    const dbManager = DatabaseManager.getInstance();
    await dbManager.logActivity('CREATE', 'storage', bucket, { type: 'bucket', public: isPublic });

    // Update storage metadata
    await MetadataService.getInstance().updateStorageMetadata();
  }

  async deleteBucket(bucket: string): Promise<boolean> {
    this.validateBucketName(bucket);

    const db = DatabaseManager.getInstance().getDb();

    // Check if bucket exists
    const bucketExists = await db
      .prepare('SELECT name FROM _storage_buckets WHERE name = ?')
      .get(bucket);

    if (!bucketExists) {
      return false;
    }

    // Get all files in bucket
    const objects = (await db
      .prepare('SELECT key FROM _storage WHERE bucket = ?')
      .all(bucket)) as Pick<StorageRecord, 'key'>[];

    // Delete bucket using backend (handles all files)
    await this.backend.deleteBucket(bucket);

    // Delete from storage table (cascade will handle _storage entries)
    await db.prepare('DELETE FROM _storage_buckets WHERE name = ?').run(bucket);

    // Log bucket deletion
    const dbManager = DatabaseManager.getInstance();
    await dbManager.logActivity('DELETE', 'storage', bucket, {
      type: 'bucket',
      files_deleted: objects.length,
    });

    // Update storage metadata
    await MetadataService.getInstance().updateStorageMetadata();

    return true;
  }

  // New methods for universal upload/download strategies
  private generateUniqueKey(filename: string): string {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const ext = path.extname(filename);
    const baseName = path.basename(filename, ext);
    const sanitizedBaseName = baseName.replace(/[^a-zA-Z0-9-_]/g, '-').substring(0, 32);
    return `${sanitizedBaseName}-${timestamp}-${randomStr}${ext}`;
  }

  async getUploadStrategy(
    bucket: string,
    metadata: {
      filename: string;
      contentType?: string;
      size?: number;
    }
  ): Promise<UploadStrategyResponse> {
    this.validateBucketName(bucket);

    // Check if bucket exists
    const db = DatabaseManager.getInstance().getDb();
    const bucketExists = await db
      .prepare('SELECT name FROM _storage_buckets WHERE name = ?')
      .get(bucket);

    if (!bucketExists) {
      throw new Error(`Bucket "${bucket}" does not exist`);
    }

    const key = this.generateUniqueKey(metadata.filename);
    return this.backend.getUploadStrategy(bucket, key, metadata);
  }

  async getDownloadStrategy(
    bucket: string,
    key: string,
    expiresIn?: number
  ): Promise<DownloadStrategyResponse> {
    this.validateBucketName(bucket);
    this.validateKey(key);
    
    // Check if bucket is public
    const isPublic = await this.isBucketPublic(bucket);
    
    return this.backend.getDownloadStrategy(bucket, key, expiresIn, isPublic);
  }

  async confirmUpload(
    bucket: string,
    key: string,
    metadata: {
      size: number;
      contentType?: string;
      etag?: string;
    }
  ): Promise<StorageFileSchema> {
    this.validateBucketName(bucket);
    this.validateKey(key);

    // Verify the file exists in storage
    const exists = await this.backend.verifyObjectExists(bucket, key);
    if (!exists) {
      throw new Error(`Upload not found for key "${key}" in bucket "${bucket}"`);
    }

    const db = DatabaseManager.getInstance().getDb();

    // Check if already confirmed
    const existing = await db
      .prepare('SELECT key FROM _storage WHERE bucket = ? AND key = ?')
      .get(bucket, key);

    if (existing) {
      throw new Error(`File "${key}" already confirmed in bucket "${bucket}"`);
    }

    // Save metadata to database
    await db
      .prepare(
        `
        INSERT INTO _storage (bucket, key, size, mime_type)
        VALUES (?, ?, ?, ?)
      `
      )
      .run(bucket, key, metadata.size, metadata.contentType || null);

    // Get the actual uploaded_at timestamp from database
    const result = (await db
      .prepare('SELECT uploaded_at as uploadedAt FROM _storage WHERE bucket = ? AND key = ?')
      .get(bucket, key)) as { uploadedAt: string } | undefined;

    if (!result) {
      throw new Error(`Failed to retrieve upload timestamp for ${bucket}/${key}`);
    }

    // Log the upload activity
    const dbManager = DatabaseManager.getInstance();
    await dbManager.logActivity('UPLOAD', `storage/${bucket}`, key, {
      size: metadata.size,
      mime_type: metadata.contentType,
      method: 'presigned',
    });

    return {
      bucket,
      key,
      size: metadata.size,
      mimeType: metadata.contentType,
      uploadedAt: result.uploadedAt,
      url: `${process.env.API_BASE_URL || 'http://localhost:7130'}/api/storage/buckets/${bucket}/objects/${encodeURIComponent(key)}`,
    };
  }
}
