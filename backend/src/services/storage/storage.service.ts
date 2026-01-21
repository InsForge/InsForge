import path from 'path';
import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { StorageRecord } from '@/types/storage.js';
import {
  StorageBucketSchema,
  StorageFileSchema,
  StorageMetadataSchema,
} from '@insforge/shared-schemas';
import { StorageProvider } from '@/providers/storage/base.provider.js';
import { LocalStorageProvider } from '@/providers/storage/local.provider.js';
import { S3StorageProvider } from '@/providers/storage/s3.provider.js';
import logger from '@/utils/logger.js';
import { escapeSqlLikePattern, escapeRegexPattern } from '@/utils/validations.js';
import { getApiBaseUrl } from '@/utils/environment.js';
import { ANON_ID } from '@/utils/constants.js';

const DEFAULT_LIST_LIMIT = 100;
const GIGABYTE_IN_BYTES = 1024 * 1024 * 1024;
const PUBLIC_BUCKET_EXPIRY = 0; // Public buckets don't expire
const PRIVATE_BUCKET_EXPIRY = 3600; // Private buckets expire in 1 hour

export class StorageService {
  private static instance: StorageService;
  private provider: StorageProvider;
  private pool: Pool | null = null;

  private constructor() {
    const s3Bucket = process.env.AWS_S3_BUCKET;
    const appKey = process.env.APP_KEY || 'local';

    if (s3Bucket) {
      // Use S3 backend
      this.provider = new S3StorageProvider(
        s3Bucket,
        appKey,
        process.env.AWS_REGION || 'us-east-2'
      );
    } else {
      // Use local filesystem backend
      const baseDir = process.env.STORAGE_DIR || path.resolve(process.cwd(), 'insforge-storage');
      this.provider = new LocalStorageProvider(baseDir);
    }
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  static getInstance(): StorageService {
    if (!StorageService.instance) {
      StorageService.instance = new StorageService();
    }
    return StorageService.instance;
  }

  async initialize(): Promise<void> {
    await this.provider.initialize();
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

  /**
   * Generate a unique object key with timestamp and random string
   * @param originalFilename - The original filename from the upload
   * @returns Generated unique key
   */
  generateObjectKey(originalFilename: string): string {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const fileExt = originalFilename ? path.extname(originalFilename) : '';
    const baseName = originalFilename ? path.basename(originalFilename, fileExt) : 'file';
    const sanitizedBaseName = baseName.replace(/[^a-zA-Z0-9-_]/g, '-').substring(0, 32);
    const objectKey = `${sanitizedBaseName}-${timestamp}-${randomStr}${fileExt}`;

    return objectKey;
  }

  /**
   * Generate the next available key for a file, using (1), (2), (3) pattern if duplicates exist
   * @param bucket - The bucket name
   * @param originalKey - The original filename
   * @returns The next available key
   */
  private async generateNextAvailableKey(bucket: string, originalKey: string): Promise<string> {
    // Parse filename and extension for potential auto-renaming
    const lastDotIndex = originalKey.lastIndexOf('.');
    const baseName = lastDotIndex > 0 ? originalKey.substring(0, lastDotIndex) : originalKey;
    const extension = lastDotIndex > 0 ? originalKey.substring(lastDotIndex) : '';

    // Use efficient SQL query to find the highest existing counter
    // This query finds all files matching the pattern and extracts the counter number
    const result = await this.getPool().query(
      `
        SELECT key FROM storage.objects
        WHERE bucket = $1
        AND (key = $2 OR key LIKE $3)
      `,
      [
        bucket,
        originalKey,
        `${escapeSqlLikePattern(baseName)} (%)${escapeSqlLikePattern(extension)}`,
      ]
    );

    const existingFiles = result.rows;
    let finalKey = originalKey;

    if (existingFiles.length) {
      // Extract counter numbers from existing files
      let incrementNumber = 0;
      // This regex is used to match the counter number in the filename, extract the increment number
      const counterRegex = new RegExp(
        `^${escapeRegexPattern(baseName)} \\((\\d+)\\)${escapeRegexPattern(extension)}$`
      );

      for (const file of existingFiles as { key: string }[]) {
        if (file.key === originalKey) {
          incrementNumber = Math.max(incrementNumber, 0); // Original file exists, so we need at least (1)
        } else {
          const match = file.key.match(counterRegex);
          if (match) {
            incrementNumber = Math.max(incrementNumber, parseInt(match[1], 10));
          }
        }
      }

      // Generate the next available filename
      finalKey = `${baseName} (${incrementNumber + 1})${extension}`;
    }

    return finalKey;
  }

  async putObject(
    bucket: string,
    originalKey: string,
    file: Express.Multer.File,
    userId?: string
  ): Promise<StorageFileSchema> {
    this.validateBucketName(bucket);
    this.validateKey(originalKey);

    // Generate next available key using (1), (2), (3) pattern if duplicates exist
    const finalKey = await this.generateNextAvailableKey(bucket, originalKey);

    // Save file using backend
    await this.provider.putObject(bucket, finalKey, file);

    // Save metadata to database and return the timestamp in one operation
    const result = await this.getPool().query(
      `
      INSERT INTO storage.objects (bucket, key, size, mime_type, uploaded_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING uploaded_at as "uploadedAt"
    `,
      [bucket, finalKey, file.size, file.mimetype || null, userId || null]
    );

    if (!result.rows[0]) {
      throw new Error(`Failed to retrieve upload timestamp for ${bucket}/${finalKey}`);
    }

    return {
      bucket,
      key: finalKey,
      size: file.size,
      mimeType: file.mimetype,
      uploadedAt: result.rows[0].uploadedAt,
      url: `${getApiBaseUrl()}/api/storage/buckets/${bucket}/objects/${encodeURIComponent(finalKey)}`,
    };
  }

  async getObject(
    bucket: string,
    key: string
  ): Promise<{ file: Buffer; metadata: StorageFileSchema } | null> {
    this.validateBucketName(bucket);
    this.validateKey(key);

    const result = await this.getPool().query(
      'SELECT * FROM storage.objects WHERE bucket = $1 AND key = $2',
      [bucket, key]
    );

    const metadata = result.rows[0] as StorageRecord | undefined;

    if (!metadata) {
      return null;
    }

    const file = await this.provider.getObject(bucket, key);
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
        url: `${getApiBaseUrl()}/api/storage/buckets/${bucket}/objects/${encodeURIComponent(key)}`,
      },
    };
  }

  async deleteObject(
    bucket: string,
    key: string,
    userId: string,
    isAdmin: boolean
  ): Promise<boolean> {
    this.validateBucketName(bucket);
    this.validateKey(key);

    // Anon users and users without ID cannot delete (unless admin)
    if (!isAdmin && (!userId || userId === ANON_ID)) {
      return false;
    }

    // Admin can delete any object, non-admin can only delete their own uploads
    const result = isAdmin
      ? await this.getPool().query('DELETE FROM storage.objects WHERE bucket = $1 AND key = $2', [
          bucket,
          key,
        ])
      : await this.getPool().query(
          'DELETE FROM storage.objects WHERE bucket = $1 AND key = $2 AND uploaded_by = $3',
          [bucket, key, userId]
        );

    // If delete succeeded in DB, also delete from storage provider
    if (result.rowCount !== null && result.rowCount > 0) {
      await this.provider.deleteObject(bucket, key);
      return true;
    }

    return false;
  }

  async listObjects(
    bucket: string,
    prefix?: string,
    limit: number = DEFAULT_LIST_LIMIT,
    offset: number = 0,
    searchQuery?: string
  ): Promise<{ objects: StorageFileSchema[]; total: number }> {
    this.validateBucketName(bucket);

    const client = await this.getPool().connect();
    try {
      let query = 'SELECT * FROM storage.objects WHERE bucket = $1';
      let countQuery = 'SELECT COUNT(*) as count FROM storage.objects WHERE bucket = $1';
      const params: (string | number)[] = [bucket];
      let paramIndex = 2;

      if (prefix) {
        query += ` AND key LIKE $${paramIndex}`;
        countQuery += ` AND key LIKE $${paramIndex}`;
        params.push(`${prefix}%`);
        paramIndex++;
      }

      // Add search functionality for file names (key field)
      if (searchQuery && searchQuery.trim()) {
        query += ` AND key LIKE $${paramIndex}`;
        countQuery += ` AND key LIKE $${paramIndex}`;
        const searchPattern = `%${searchQuery.trim()}%`;
        params.push(searchPattern);
        paramIndex++;
      }

      query += ` ORDER BY key LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      const queryParams = [...params, limit, offset];

      const objectsResult = await client.query(query, queryParams);
      const totalResult = await client.query(countQuery, params);

      return {
        objects: objectsResult.rows.map((obj) => ({
          ...obj,
          mimeType: obj.mime_type,
          uploadedAt: obj.uploaded_at,
          url: `${getApiBaseUrl()}/api/storage/buckets/${bucket}/objects/${encodeURIComponent(obj.key)}`,
        })),
        total: parseInt(totalResult.rows[0].count, 10),
      };
    } finally {
      client.release();
    }
  }

  async isBucketPublic(bucket: string): Promise<boolean> {
    const result = await this.getPool().query(
      'SELECT public FROM storage.buckets WHERE name = $1',
      [bucket]
    );
    return result.rows[0]?.public || false;
  }

  async updateBucketVisibility(bucket: string, isPublic: boolean): Promise<void> {
    const client = await this.getPool().connect();
    try {
      // Check if bucket exists
      const bucketResult = await client.query('SELECT name FROM storage.buckets WHERE name = $1', [
        bucket,
      ]);

      if (!bucketResult.rows[0]) {
        throw new Error(`Bucket "${bucket}" does not exist`);
      }

      // Update bucket visibility in storage.buckets table
      await client.query(
        'UPDATE storage.buckets SET public = $1, updated_at = CURRENT_TIMESTAMP WHERE name = $2',
        [isPublic, bucket]
      );

      // Update storage metadata
      // Metadata is now updated on-demand
    } finally {
      client.release();
    }
  }

  async listBuckets(): Promise<StorageBucketSchema[]> {
    // Get all buckets with their metadata from storage.buckets table
    const result = await this.getPool().query(
      'SELECT name, public, created_at as "createdAt" FROM storage.buckets ORDER BY name'
    );

    return result.rows as StorageBucketSchema[];
  }

  async createBucket(bucket: string, isPublic: boolean = true): Promise<void> {
    this.validateBucketName(bucket);

    const client = await this.getPool().connect();
    try {
      // Check if bucket already exists
      const existing = await client.query('SELECT name FROM storage.buckets WHERE name = $1', [
        bucket,
      ]);

      if (existing.rows[0]) {
        throw new Error(`Bucket "${bucket}" already exists`);
      }

      // Insert bucket into storage.buckets table
      await client.query('INSERT INTO storage.buckets (name, public) VALUES ($1, $2)', [
        bucket,
        isPublic,
      ]);

      // Create bucket using backend
      await this.provider.createBucket(bucket);

      // Update storage metadata
      // Metadata is now updated on-demand
    } finally {
      client.release();
    }
  }

  async deleteBucket(bucket: string): Promise<boolean> {
    this.validateBucketName(bucket);

    const client = await this.getPool().connect();
    try {
      // Check if bucket exists
      const bucketResult = await client.query('SELECT name FROM storage.buckets WHERE name = $1', [
        bucket,
      ]);

      if (!bucketResult.rows[0]) {
        return false;
      }

      // Delete bucket using backend (handles all files)
      await this.provider.deleteBucket(bucket);

      // Delete from storage table (cascade will handle storage.objects entries)
      await client.query('DELETE FROM storage.buckets WHERE name = $1', [bucket]);

      // Update storage metadata
      // Metadata is now updated on-demand

      return true;
    } finally {
      client.release();
    }
  }

  // New methods for universal upload/download strategies
  async getUploadStrategy(
    bucket: string,
    metadata: {
      filename: string;
      contentType?: string;
      size?: number;
    }
  ) {
    this.validateBucketName(bucket);

    const client = await this.getPool().connect();
    try {
      // Check if bucket exists
      const bucketResult = await client.query('SELECT name FROM storage.buckets WHERE name = $1', [
        bucket,
      ]);

      if (!bucketResult.rows[0]) {
        throw new Error(`Bucket "${bucket}" does not exist`);
      }

      // Generate next available key using (1), (2), (3) pattern if duplicates exist
      const key = await this.generateNextAvailableKey(bucket, metadata.filename);
      return this.provider.getUploadStrategy(bucket, key, metadata);
    } finally {
      client.release();
    }
  }

  async getDownloadStrategy(bucket: string, key: string) {
    this.validateBucketName(bucket);
    this.validateKey(key);

    // Check if bucket is public
    const isPublic = await this.isBucketPublic(bucket);

    // Auto-calculate expiry based on bucket visibility if not provided
    const expiresIn = isPublic ? PUBLIC_BUCKET_EXPIRY : PRIVATE_BUCKET_EXPIRY;

    return this.provider.getDownloadStrategy(bucket, key, expiresIn, isPublic);
  }

  async confirmUpload(
    bucket: string,
    key: string,
    metadata: {
      size: number;
      contentType?: string;
      etag?: string;
    },
    userId?: string
  ): Promise<StorageFileSchema> {
    this.validateBucketName(bucket);
    this.validateKey(key);

    // Verify the file exists in storage
    const exists = await this.provider.verifyObjectExists(bucket, key);
    if (!exists) {
      throw new Error(`Upload not found for key "${key}" in bucket "${bucket}"`);
    }

    // Check if already confirmed
    const existingResult = await this.getPool().query(
      'SELECT key FROM storage.objects WHERE bucket = $1 AND key = $2',
      [bucket, key]
    );

    if (existingResult.rows[0]) {
      throw new Error(`File "${key}" already confirmed in bucket "${bucket}"`);
    }

    // Save metadata to database and return the timestamp in one operation
    const result = await this.getPool().query(
      `
      INSERT INTO storage.objects (bucket, key, size, mime_type, uploaded_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING uploaded_at as "uploadedAt"
    `,
      [bucket, key, metadata.size, metadata.contentType || null, userId || null]
    );

    if (!result.rows[0]) {
      throw new Error(`Failed to retrieve upload timestamp for ${bucket}/${key}`);
    }

    return {
      bucket,
      key,
      size: metadata.size,
      mimeType: metadata.contentType,
      uploadedAt: result.rows[0].uploadedAt,
      url: `${getApiBaseUrl()}/api/storage/buckets/${bucket}/objects/${encodeURIComponent(key)}`,
    };
  }

  /**
   * Get storage metadata
   */
  async getMetadata(): Promise<StorageMetadataSchema> {
    // Get storage buckets from storage.buckets table
    const result = await this.getPool().query(
      'SELECT name, public, created_at as "createdAt" FROM storage.buckets ORDER BY name'
    );

    const storageBuckets = result.rows as StorageBucketSchema[];

    // Get object counts for each bucket
    const bucketsObjectCountMap = await this.getBucketsObjectCount();
    const storageSize = await this.getStorageSizeInGB();

    return {
      buckets: storageBuckets.map((bucket) => ({
        ...bucket,
        objectCount: bucketsObjectCountMap.get(bucket.name) ?? 0,
      })),
      totalSizeInGB: storageSize,
    };
  }

  private async getBucketsObjectCount(): Promise<Map<string, number>> {
    try {
      // Query to get object count for each bucket
      const result = await this.getPool().query(
        'SELECT bucket, COUNT(*) as count FROM storage.objects GROUP BY bucket'
      );

      const bucketCounts = result.rows as { bucket: string; count: string }[];

      // Convert to Map for easy lookup
      const countMap = new Map<string, number>();
      bucketCounts.forEach((row) => {
        countMap.set(row.bucket, parseInt(row.count, 10));
      });

      return countMap;
    } catch (error) {
      logger.error('Error getting bucket object counts', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Return empty map on error
      return new Map<string, number>();
    }
  }

  private async getStorageSizeInGB(): Promise<number> {
    try {
      // Query the storage.objects table to sum all file sizes
      const result = await this.getPool().query(
        `
        SELECT COALESCE(SUM(size), 0) as total_size
        FROM storage.objects
      `
      );

      const totalSize = result.rows[0]?.total_size || 0;

      // Convert bytes to GB
      return Number(totalSize) / GIGABYTE_IN_BYTES;
    } catch (error) {
      logger.error('Error getting storage size', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }
}
