import path from 'path';
import { DatabaseManager } from '@/infra/database/manager.js';
import { StorageRecord, BucketRecord } from '@/types/storage.js';
import { StorageFileSchema, StorageMetadataSchema } from '@insforge/shared-schemas';
import { StorageProvider } from '@/providers/storage/base.provider.js';
import { LocalStorageProvider } from '@/providers/storage/local.provider.js';
import { S3StorageProvider } from '@/providers/storage/s3.provider.js';
import logger from '@/utils/logger.js';
import { ADMIN_ID } from '@/utils/constants';
import { AppError } from '@/api/middleware/error';
import { ERROR_CODES } from '@/types/error-constants';
import { escapeSqlLikePattern, escapeRegexPattern } from '@/utils/validations.js';
import { getApiBaseUrl } from '@/utils/environment';

const DEFAULT_LIST_LIMIT = 100;
const GIGABYTE_IN_BYTES = 1024 * 1024 * 1024;

export class StorageService {
  private static instance: StorageService;
  private backend: StorageProvider;

  private constructor() {
    const s3Bucket = process.env.AWS_S3_BUCKET;
    const appKey = process.env.APP_KEY || 'local';

    if (s3Bucket) {
      // Use S3 backend
      this.backend = new S3StorageProvider(s3Bucket, appKey, process.env.AWS_REGION || 'us-east-2');
    } else {
      // Use local filesystem backend
      const baseDir = process.env.STORAGE_DIR || path.resolve(process.cwd(), 'insforge-storage');
      this.backend = new LocalStorageProvider(baseDir);
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

  /**
   * Generate the next available key for a file, using (1), (2), (3) pattern if duplicates exist
   * @param bucket - The bucket name
   * @param originalKey - The original filename
   * @returns The next available key
   */
  private async generateNextAvailableKey(bucket: string, originalKey: string): Promise<string> {
    const db = DatabaseManager.getInstance().getDb();

    // Parse filename and extension for potential auto-renaming
    const lastDotIndex = originalKey.lastIndexOf('.');
    const baseName = lastDotIndex > 0 ? originalKey.substring(0, lastDotIndex) : originalKey;
    const extension = lastDotIndex > 0 ? originalKey.substring(lastDotIndex) : '';

    // Use efficient SQL query to find the highest existing counter
    // This query finds all files matching the pattern and extracts the counter number
    const existingFiles = await db
      .prepare(
        `
        SELECT key FROM _storage
        WHERE bucket = ?
        AND (key = ? OR key LIKE ?)
      `
      )
      .all(
        bucket,
        originalKey,
        `${escapeSqlLikePattern(baseName)} (%)${escapeSqlLikePattern(extension)}`
      );

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

    const db = DatabaseManager.getInstance().getDb();

    // Generate next available key using (1), (2), (3) pattern if duplicates exist
    const finalKey = await this.generateNextAvailableKey(bucket, originalKey);

    // Save file using backend
    await this.backend.putObject(bucket, finalKey, file);

    // Save metadata to database
    await db
      .prepare(
        `
      INSERT INTO _storage (bucket, key, size, mime_type, uploaded_by)
      VALUES (?, ?, ?, ?, ?)
    `
      )
      .run(
        bucket,
        finalKey,
        file.size,
        file.mimetype || null,
        userId && userId !== ADMIN_ID ? userId : null
      );

    // Get the actual uploaded_at timestamp from database (with alias for camelCase)
    const result = (await db
      .prepare('SELECT uploaded_at as uploadedAt FROM _storage WHERE bucket = ? AND key = ?')
      .get(bucket, finalKey)) as { uploadedAt: string } | undefined;

    if (!result) {
      throw new Error(`Failed to retrieve upload timestamp for ${bucket}/${finalKey}`);
    }

    return {
      bucket,
      key: finalKey,
      size: file.size,
      mimeType: file.mimetype,
      uploadedAt: result.uploadedAt,
      url: `${getApiBaseUrl()}/api/storage/buckets/${bucket}/objects/${encodeURIComponent(finalKey)}`,
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
        url: `${getApiBaseUrl()}/api/storage/buckets/${bucket}/objects/${encodeURIComponent(key)}`,
      },
    };
  }

  async deleteObject(
    bucket: string,
    key: string,
    userId?: string,
    isAdmin?: boolean
  ): Promise<boolean> {
    this.validateBucketName(bucket);
    this.validateKey(key);

    const db = DatabaseManager.getInstance().getDb();

    // Check permissions
    if (!isAdmin) {
      const file = (await db
        .prepare('SELECT uploaded_by FROM _storage WHERE bucket = ? AND key = ?')
        .get(bucket, key)) as { uploaded_by: string | null } | undefined;

      if (!file) {
        return false; // File doesn't exist
      }

      // Check if user owns the file
      if (userId && file.uploaded_by !== userId) {
        throw new AppError(
          'Permission denied: You can only delete files you uploaded',
          403,
          ERROR_CODES.FORBIDDEN
        );
      }
    }

    // Delete file using backend
    await this.backend.deleteObject(bucket, key);

    // Delete from database
    const result = await db
      .prepare('DELETE FROM _storage WHERE bucket = ? AND key = ?')
      .run(bucket, key);

    return result.changes > 0;
  }

  async listObjects(
    bucket: string,
    prefix?: string,
    limit: number = DEFAULT_LIST_LIMIT,
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
        url: `${getApiBaseUrl()}/api/storage/buckets/${bucket}/objects/${encodeURIComponent(obj.key)}`,
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

    // Update storage metadata
    // Metadata is now updated on-demand
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

    // Update storage metadata
    // Metadata is now updated on-demand
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

    // Delete bucket using backend (handles all files)
    await this.backend.deleteBucket(bucket);

    // Delete from storage table (cascade will handle _storage entries)
    await db.prepare('DELETE FROM _storage_buckets WHERE name = ?').run(bucket);

    // Update storage metadata
    // Metadata is now updated on-demand

    return true;
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

    // Check if bucket exists
    const db = DatabaseManager.getInstance().getDb();
    const bucketExists = await db
      .prepare('SELECT name FROM _storage_buckets WHERE name = ?')
      .get(bucket);

    if (!bucketExists) {
      throw new Error(`Bucket "${bucket}" does not exist`);
    }

    // Generate next available key using (1), (2), (3) pattern if duplicates exist
    const key = await this.generateNextAvailableKey(bucket, metadata.filename);
    return this.backend.getUploadStrategy(bucket, key, metadata);
  }

  async getDownloadStrategy(bucket: string, key: string, expiresIn?: number) {
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
    },
    userId?: string
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
        INSERT INTO _storage (bucket, key, size, mime_type, uploaded_by)
        VALUES (?, ?, ?, ?, ?)
      `
      )
      .run(
        bucket,
        key,
        metadata.size,
        metadata.contentType || null,
        userId && userId !== ADMIN_ID ? userId : null
      );

    // Get the actual uploaded_at timestamp from database
    const result = (await db
      .prepare('SELECT uploaded_at as uploadedAt FROM _storage WHERE bucket = ? AND key = ?')
      .get(bucket, key)) as { uploadedAt: string } | undefined;

    if (!result) {
      throw new Error(`Failed to retrieve upload timestamp for ${bucket}/${key}`);
    }

    return {
      bucket,
      key,
      size: metadata.size,
      mimeType: metadata.contentType,
      uploadedAt: result.uploadedAt,
      url: `${getApiBaseUrl()}/api/storage/buckets/${bucket}/objects/${encodeURIComponent(key)}`,
    };
  }

  /**
   * Get storage metadata
   */
  async getMetadata(): Promise<StorageMetadataSchema> {
    const db = DatabaseManager.getInstance().getDb();
    // Get storage buckets from _storage_buckets table
    const storageBuckets = (await db
      .prepare('SELECT name, public, created_at FROM _storage_buckets ORDER BY name')
      .all()) as { name: string; public: boolean; created_at: string }[];

    const bucketsMetadata = storageBuckets.map((b) => ({
      name: b.name,
      public: b.public,
      createdAt: b.created_at,
    }));

    // Get object counts for each bucket
    const bucketsObjectCountMap = await this.getBucketsObjectCount();
    const storageSize = await this.getStorageSizeInGB();

    return {
      buckets: bucketsMetadata.map((bucket) => ({
        ...bucket,
        objectCount: bucketsObjectCountMap.get(bucket.name) ?? 0,
      })),
      totalSizeInGB: storageSize,
    };
  }

  private async getBucketsObjectCount(): Promise<Map<string, number>> {
    const db = DatabaseManager.getInstance().getDb();
    try {
      // Query to get object count for each bucket
      const bucketCounts = (await db
        .prepare('SELECT bucket, COUNT(*) as count FROM _storage GROUP BY bucket')
        .all()) as { bucket: string; count: number }[];

      // Convert to Map for easy lookup
      const countMap = new Map<string, number>();
      bucketCounts.forEach((row) => {
        countMap.set(row.bucket, row.count);
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
    const db = DatabaseManager.getInstance().getDb();
    try {
      // Query the _storage table to sum all file sizes
      const result = (await db
        .prepare(
          `
        SELECT COALESCE(SUM(size), 0) as total_size
        FROM _storage
      `
        )
        .get()) as { total_size: number } | null;

      // Convert bytes to GB
      return (result?.total_size || 0) / GIGABYTE_IN_BYTES;
    } catch (error) {
      logger.error('Error getting storage size', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }
}
