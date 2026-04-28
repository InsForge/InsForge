import path from 'path';
import { Pool, PoolClient } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { withUserContext, UserContext } from '@/services/db/user-context.service.js';
import { StorageRecord } from '@/types/storage.js';
import {
  StorageBucketSchema,
  StorageFileSchema,
  StorageMetadataSchema,
} from '@insforge/shared-schemas';
import { StorageProvider } from '@/providers/storage/base.provider.js';
import { LocalStorageProvider } from '@/providers/storage/local.provider.js';
import { S3StorageProvider } from '@/providers/storage/s3.provider.js';
import { StorageConfigService } from '@/services/storage/storage-config.service.js';
import logger from '@/utils/logger.js';
import { escapeSqlLikePattern, escapeRegexPattern } from '@/utils/validations.js';
import { getApiBaseUrl } from '@/utils/environment.js';

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
  private async generateNextAvailableKey(
    bucket: string,
    originalKey: string,
    db: PoolClient | Pool
  ): Promise<string> {
    // Parse filename and extension for potential auto-renaming
    const lastDotIndex = originalKey.lastIndexOf('.');
    const baseName = lastDotIndex > 0 ? originalKey.substring(0, lastDotIndex) : originalKey;
    const extension = lastDotIndex > 0 ? originalKey.substring(lastDotIndex) : '';

    // Use efficient SQL query to find the highest existing counter.
    // Runs through the caller's user-context client, so RLS scopes the
    // dedup check to keys the caller can actually see — different users
    // can independently upload `note.txt` without conflict.
    const result = await db.query(
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
    ctx: UserContext,
    bucket: string,
    originalKey: string,
    file: Express.Multer.File
  ): Promise<StorageFileSchema> {
    this.validateBucketName(bucket);
    this.validateKey(originalKey);

    return withUserContext(this.getPool(), ctx, async (db) => {
      // Generate next available key using (1), (2), (3) pattern if duplicates exist.
      // RLS scopes the dedup check to keys the caller can actually see, so two
      // users can independently upload `note.txt` without conflict.
      const finalKey = await this.generateNextAvailableKey(bucket, originalKey, db);

      // Provider write happens before INSERT. The INSERT's RLS WITH CHECK is
      // unreachable in practice because uploaded_by is always ctx.userId, which
      // is the same value the policy reads via auth.jwt() ->> 'sub'. Any
      // non-RLS INSERT failure (unique conflict, transient DB error) leaves
      // the blob orphaned on the provider; the rollback only undoes the DB.
      await this.provider.putObject(bucket, finalKey, file);

      // INSERT is checked against the storage_objects_owner_insert RLS policy.
      const result = await db.query(
        `
        INSERT INTO storage.objects (bucket, key, size, mime_type, uploaded_by, uploaded_via)
        VALUES ($1, $2, $3, $4, $5, 'rest')
        RETURNING uploaded_at as "uploadedAt"
      `,
        [bucket, finalKey, file.size, file.mimetype || null, ctx.userId || null]
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
    });
  }

  async getObject(
    ctx: UserContext,
    bucket: string,
    key: string
  ): Promise<{ file: Buffer; metadata: StorageFileSchema } | null> {
    this.validateBucketName(bucket);
    this.validateKey(key);

    // RLS filters this SELECT — non-owners get an empty result and a 404.
    const metadata = await withUserContext(this.getPool(), ctx, async (db) => {
      const result = await db.query(
        'SELECT * FROM storage.objects WHERE bucket = $1 AND key = $2',
        [bucket, key]
      );
      return result.rows[0] as StorageRecord | undefined;
    });

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

  async deleteObject(ctx: UserContext, bucket: string, key: string): Promise<boolean> {
    this.validateBucketName(bucket);
    this.validateKey(key);

    // RLS-gated SELECT first; if the caller can't see the row we abort
    // before touching the provider. Provider delete then DB delete in
    // that order — a provider failure leaves both sides intact and a
    // retry resolves cleanly, whereas DB-first would orphan the blob.
    //
    // This relies on `provider.deleteObject` being idempotent on missing
    // keys. S3 DELETE is (returns 204 either way); LocalStorageProvider's
    // unlink swallows ENOENT. A future provider that throws on missing
    // keys would break retry safety here — keep that contract.
    return withUserContext(this.getPool(), ctx, async (db) => {
      const found = await db.query('SELECT 1 FROM storage.objects WHERE bucket = $1 AND key = $2', [
        bucket,
        key,
      ]);
      if ((found.rowCount ?? 0) === 0) {
        return false;
      }

      await this.provider.deleteObject(bucket, key);

      const result = await db.query('DELETE FROM storage.objects WHERE bucket = $1 AND key = $2', [
        bucket,
        key,
      ]);
      return (result.rowCount ?? 0) > 0;
    });
  }

  async listObjects(
    ctx: UserContext,
    bucket: string,
    prefix: string | undefined,
    limit: number = DEFAULT_LIST_LIMIT,
    offset: number = 0,
    searchQuery: string | undefined
  ): Promise<{ objects: StorageFileSchema[]; total: number }> {
    this.validateBucketName(bucket);

    let query = 'SELECT * FROM storage.objects WHERE bucket = $1';
    let countQuery = 'SELECT COUNT(*) as count FROM storage.objects WHERE bucket = $1';
    const params: (string | number)[] = [bucket];
    let paramIndex = 2;

    if (prefix) {
      query += ` AND key LIKE $${paramIndex}`;
      countQuery += ` AND key LIKE $${paramIndex}`;
      params.push(`${escapeSqlLikePattern(prefix)}%`);
      paramIndex++;
    }

    // Add search functionality for file names (key field)
    if (searchQuery && searchQuery.trim()) {
      query += ` AND key LIKE $${paramIndex}`;
      countQuery += ` AND key LIKE $${paramIndex}`;
      const searchPattern = `%${escapeSqlLikePattern(searchQuery.trim())}%`;
      params.push(searchPattern);
      paramIndex++;
    }

    query += ` ORDER BY key LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    const queryParams = [...params, limit, offset];

    // RLS scopes both queries — admin sees everything, authenticated callers
    // see only rows their policies allow. No app-side filter.
    return withUserContext(this.getPool(), ctx, async (db) => {
      const objectsResult = await db.query(query, queryParams);
      const totalResult = await db.query(countQuery, params);

      return {
        objects: objectsResult.rows.map((obj) => ({
          ...obj,
          mimeType: obj.mime_type,
          uploadedAt: obj.uploaded_at,
          url: `${getApiBaseUrl()}/api/storage/buckets/${bucket}/objects/${encodeURIComponent(obj.key)}`,
        })),
        total: parseInt(totalResult.rows[0].count, 10),
      };
    });
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

      // Create bucket using backend first — if this fails, no DB row is written
      // so there is no orphaned record causing a permanent 409 on retry
      await this.provider.createBucket(bucket);

      // Insert bucket into storage.buckets table
      await client.query('INSERT INTO storage.buckets (name, public) VALUES ($1, $2)', [
        bucket,
        isPublic,
      ]);

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

      // Delete from DB first — if DB delete fails, files remain intact and retry is safe.
      // If provider.deleteBucket fails after this point, all objects are cascade-deleted
      // from the database but files remain orphaned in storage.
      await client.query('DELETE FROM storage.buckets WHERE name = $1', [bucket]);

      // Delete bucket using backend (handles all files)
      await this.provider.deleteBucket(bucket);

      // Update storage metadata
      // Metadata is now updated on-demand

      return true;
    } finally {
      client.release();
    }
  }

  // New methods for universal upload/download strategies
  async getUploadStrategy(
    ctx: UserContext,
    bucket: string,
    metadata: {
      filename: string;
      contentType?: string;
      size?: number;
    }
  ) {
    this.validateBucketName(bucket);

    return withUserContext(this.getPool(), ctx, async (client) => {
      // Check if bucket exists
      const bucketResult = await client.query('SELECT name FROM storage.buckets WHERE name = $1', [
        bucket,
      ]);

      if (!bucketResult.rows[0]) {
        throw new Error(`Bucket "${bucket}" does not exist`);
      }

      // Generate next available key using (1), (2), (3) pattern. RLS scopes
      // the dedup query so users don't conflict on filenames they can't see.
      const key = await this.generateNextAvailableKey(bucket, metadata.filename, client);
      const maxFileSizeBytes = await StorageConfigService.getInstance().getMaxFileSizeBytes();
      return this.provider.getUploadStrategy(bucket, key, metadata, maxFileSizeBytes);
    });
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

  /**
   * RLS-gated existence check. Returns true iff the caller is allowed by
   * `storage.objects` RLS policies to see this row. Used by routes that
   * issue presigned URLs (S3 backend) before redirecting — the presigned
   * URL itself bypasses RLS, so the route must do the ownership check
   * before handing the URL out. Admin contexts always return true (admin
   * bypasses RLS at the DB level).
   */
  async objectIsVisible(ctx: UserContext, bucket: string, key: string): Promise<boolean> {
    this.validateBucketName(bucket);
    this.validateKey(key);

    return withUserContext(this.getPool(), ctx, async (db) => {
      const result = await db.query(
        'SELECT 1 FROM storage.objects WHERE bucket = $1 AND key = $2',
        [bucket, key]
      );
      return (result.rowCount ?? 0) > 0;
    });
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

    // Verify the file exists in storage and get its actual size
    const { exists, size: actualSize } = await this.provider.verifyObjectExists(bucket, key);
    if (!exists) {
      throw new Error(`Upload not found for key "${key}" in bucket "${bucket}"`);
    }

    // Defense-in-depth: reject if the actual size exceeds the configured limit
    const fileSize = actualSize ?? metadata.size;
    const maxBytes = await StorageConfigService.getInstance().getMaxFileSizeBytes();
    if (fileSize > maxBytes) {
      const limitMb = Math.round(maxBytes / (1024 * 1024));
      throw new Error(`File size exceeds the configured maximum upload size of ${limitMb} MB`);
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
      INSERT INTO storage.objects (bucket, key, size, mime_type, uploaded_by, uploaded_via)
      VALUES ($1, $2, $3, $4, $5, 'rest')
      RETURNING uploaded_at as "uploadedAt"
    `,
      [bucket, key, fileSize, metadata.contentType || null, userId || null]
    );

    if (!result.rows[0]) {
      throw new Error(`Failed to retrieve upload timestamp for ${bucket}/${key}`);
    }

    return {
      bucket,
      key,
      size: fileSize,
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

  // ==========================================================================
  // S3 Protocol helpers — used by /storage/v1/s3 handlers.
  // ==========================================================================

  getProvider(): StorageProvider {
    return this.provider;
  }

  isS3Provider(): boolean {
    return this.provider instanceof S3StorageProvider;
  }

  /**
   * Upsert object metadata after an S3-protocol PutObject or CompleteMultipartUpload.
   * uploaded_by stays NULL; uploaded_via='s3' + s3_access_key_id distinguish S3 uploads.
   *
   * Note on RLS: under the migration's default `storage_objects_owner_select`
   * policy (`uploaded_by = auth.jwt() ->> 'sub'`), `NULL = '<sub>'` is never
   * true — so S3-uploaded rows are invisible to authenticated end-users via
   * the user API. Admin (API key / project_admin) bypasses RLS and sees them.
   * Projects that mix the S3 protocol and the user API on the same bucket
   * should write a custom SELECT policy that handles `uploaded_by IS NULL`
   * explicitly (e.g., `uploaded_by IS NULL OR uploaded_by = auth.jwt()...`).
   */
  async upsertS3Object(params: {
    bucket: string;
    key: string;
    size: number;
    etag: string;
    contentType?: string | null;
    s3AccessKeyId: string;
  }): Promise<void> {
    await this.getPool().query(
      `INSERT INTO storage.objects
         (bucket, key, size, mime_type, etag, uploaded_at, uploaded_by, uploaded_via, s3_access_key_id)
       VALUES ($1, $2, $3, $4, $5, NOW(), NULL, 's3', $6)
       ON CONFLICT (bucket, key) DO UPDATE SET
         size             = EXCLUDED.size,
         mime_type        = EXCLUDED.mime_type,
         etag             = EXCLUDED.etag,
         uploaded_at      = EXCLUDED.uploaded_at,
         uploaded_via     = EXCLUDED.uploaded_via,
         s3_access_key_id = EXCLUDED.s3_access_key_id,
         uploaded_by      = NULL`,
      [
        params.bucket,
        params.key,
        params.size,
        params.contentType ?? null,
        params.etag,
        params.s3AccessKeyId,
      ]
    );
  }

  async getObjectMetadataRow(
    bucket: string,
    key: string
  ): Promise<null | {
    size: number;
    etag: string | null;
    mimeType: string | null;
    uploadedAt: Date;
  }> {
    const r = await this.getPool().query(
      `SELECT size, etag, mime_type, uploaded_at
       FROM storage.objects
       WHERE bucket = $1 AND key = $2`,
      [bucket, key]
    );
    if (r.rowCount === 0) {
      return null;
    }
    const row = r.rows[0];
    return {
      size: Number(row.size),
      etag: row.etag,
      mimeType: row.mime_type,
      uploadedAt: row.uploaded_at,
    };
  }

  async deleteObjectRow(bucket: string, key: string): Promise<void> {
    await this.getPool().query('DELETE FROM storage.objects WHERE bucket=$1 AND key=$2', [
      bucket,
      key,
    ]);
  }

  async deleteObjectRowsBatch(bucket: string, keys: string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }
    await this.getPool().query(
      `DELETE FROM storage.objects WHERE bucket=$1 AND key = ANY($2::text[])`,
      [bucket, keys]
    );
  }

  async bucketExists(bucket: string): Promise<boolean> {
    const r = await this.getPool().query('SELECT 1 FROM storage.buckets WHERE name=$1 LIMIT 1', [
      bucket,
    ]);
    return (r.rowCount ?? 0) === 1;
  }

  async bucketIsEmpty(bucket: string): Promise<boolean> {
    const r = await this.getPool().query('SELECT 1 FROM storage.objects WHERE bucket=$1 LIMIT 1', [
      bucket,
    ]);
    return (r.rowCount ?? 0) === 0;
  }

  async listAllBucketsSimple(): Promise<Array<{ name: string; createdAt: Date }>> {
    const r = await this.getPool().query(
      'SELECT name, created_at FROM storage.buckets ORDER BY name'
    );
    return r.rows.map((row) => ({ name: row.name, createdAt: row.created_at }));
  }

  async listObjectsV2Db(params: {
    bucket: string;
    prefix?: string;
    startAfter?: string;
    maxKeys: number;
  }): Promise<Array<{ key: string; size: number; etag: string | null; lastModified: Date }>> {
    const prefix = params.prefix ?? '';
    // S3 prefixes are literal strings. `_` and `%` are SQL LIKE wildcards,
    // so a prefix like "foo_" would match "fooX" keys without escaping.
    const likePrefix = escapeSqlLikePattern(prefix) + '%';
    const rows = await this.getPool().query(
      `SELECT key, size, etag, uploaded_at
       FROM storage.objects
       WHERE bucket = $1
         AND key LIKE $2
         AND ($3::text IS NULL OR key > $3)
       ORDER BY key
       LIMIT $4`,
      [params.bucket, likePrefix, params.startAfter ?? null, params.maxKeys]
    );
    return rows.rows.map((r) => ({
      key: r.key,
      size: Number(r.size),
      etag: r.etag,
      lastModified: r.uploaded_at,
    }));
  }
}
