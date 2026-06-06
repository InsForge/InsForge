import path from 'path';
import { Pool, PoolClient } from 'pg';
import { AppError } from '@/utils/errors.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import type { UserContext } from '@/api/middlewares/auth.js';
import { withUserContext } from '@/services/database/user-context.service.js';
import { StorageRecord } from '@/types/storage.js';
import {
  ERROR_CODES,
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
import { appConfig } from '@/infra/config/app.config.js';

const DEFAULT_LIST_LIMIT = 100;
const GIGABYTE_IN_BYTES = 1024 * 1024 * 1024;
const PUBLIC_BUCKET_EXPIRY = 0; // Public buckets don't expire
const PRIVATE_BUCKET_EXPIRY = 3600; // Private buckets expire in 1 hour

type StorageObjectResult = {
  file: Buffer;
  metadata: StorageFileSchema;
};

export class StorageService {
  private static instance: StorageService;
  private provider: StorageProvider;
  private pool: Pool | null = null;

  private constructor() {
    const s3Bucket = appConfig.storage.s3Bucket;
    const appKey = appConfig.storage.appKey;
    // PARENT_APP_KEY is set by cloud-backend at branch EC2 startup. When
    // present, the S3 provider runs in branch mode: read paths fall back to
    // parent's S3 prefix on 404, write paths target the branch's prefix only.
    const parentAppKey = appConfig.storage.parentAppKey;

    if (s3Bucket) {
      // Use S3 backend
      this.provider = new S3StorageProvider(
        s3Bucket,
        appKey,
        appConfig.storage.awsRegion,
        parentAppKey
      );
      if (parentAppKey) {
        logger.info('Storage initialized in branch mode', { appKey, parentAppKey });
      }
    } else {
      // Use local filesystem backend (no fallback support — local installs aren't branched)
      this.provider = new LocalStorageProvider(appConfig.storage.storageDir);
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
   * Build the canonical download URL with a cache-busting `?v=<version>`
   * query param. CDNs (CloudFront, Cloudflare, etc.) key cache entries by
   * full URL — same key + same URL would serve stale bytes after an
   * overwrite. The version stamp changes on every upload (etag if known,
   * otherwise an epoch-ms uploaded_at), so each new upload yields a fresh
   * URL and a guaranteed cache miss without any invalidation API call.
   *
   * The CDN itself must be configured to include `v` in its cache key for
   * this to take effect (CloudFront default is to ignore query strings).
   */
  private buildObjectUrl(bucket: string, key: string, version?: string | Date | null): string {
    const base = `${getApiBaseUrl()}/api/storage/buckets/${bucket}/objects/${encodeURIComponent(key)}`;
    const stamp = this.toVersionStamp(version);
    return stamp ? `${base}?v=${encodeURIComponent(stamp)}` : base;
  }

  private toVersionStamp(version: string | Date | null | undefined): string {
    if (!version) {
      return '';
    }
    if (version instanceof Date) {
      return version.getTime().toString();
    }
    return version;
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

    // Dedup runs on the admin pool so it sees ALL rows, not just those
    // RLS lets the caller view. Otherwise an RLS-hidden collision would
    // pass the check and silently overwrite another user's blob — the
    // (bucket, key) keyspace is globally unique. Two users uploading
    // `note.txt` get `note.txt` and `note (1).txt` respectively.
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
    ctx: UserContext | undefined,
    bucket: string,
    originalKey: string,
    file: Express.Multer.File,
    hasApiKey: boolean = false
  ): Promise<StorageFileSchema> {
    this.validateBucketName(bucket);
    this.validateKey(originalKey);

    // Raw-pool dedup sees all rows and avoids silent cross-user blob overwrite.
    const finalKey = await this.generateNextAvailableKey(bucket, originalKey, this.getPool());

    const userId = ctx?.id ?? null;
    const insertObject = async (db: PoolClient) => {
      // INSERT before provider write so UNIQUE (bucket, key) catches any
      // race-window collision before any blob is touched. Provider write
      // stays inside the transaction — a provider failure throws, the tx
      // rolls back, and no orphan row remains.
      const result = await db.query(
        `
        INSERT INTO storage.objects (bucket, key, size, mime_type, uploaded_by, uploaded_via)
        VALUES ($1, $2, $3, $4, $5, 'rest')
        RETURNING uploaded_at as "uploadedAt"
      `,
        [bucket, finalKey, file.size, file.mimetype || null, userId]
      );

      if (!result.rows[0]) {
        throw new Error(`Failed to retrieve upload timestamp for ${bucket}/${finalKey}`);
      }

      const { etag: providerEtag } = await this.provider.putObject(bucket, finalKey, file);
      return { etag: providerEtag, uploadedAt: result.rows[0].uploadedAt };
    };
    let uploadedObject: Awaited<ReturnType<typeof insertObject>>;
    if (hasApiKey || ctx?.role === 'project_admin') {
      uploadedObject = await runWithRootAccess(this.getPool(), insertObject);
    } else {
      if (!ctx) {
        throw new AppError('Forbidden', 403, ERROR_CODES.STORAGE_PERMISSION_DENIED);
      }
      uploadedObject = await withUserContext(this.getPool(), ctx, insertObject);
    }
    const { etag, uploadedAt } = uploadedObject;

    // Persist the etag as a best-effort step OUTSIDE the user-context
    // transaction. If we ran this inside the tx and the UPDATE failed, the
    // INSERT would roll back but the provider blob would already be written
    // — leaving an orphan in S3. Done out here, an UPDATE failure only
    // degrades CDN cache-busting precision (URLs fall back to uploaded_at as
    // the version stamp) instead of permanently leaking storage.
    if (etag) {
      try {
        await this.getPool().query(
          'UPDATE storage.objects SET etag = $1 WHERE bucket = $2 AND key = $3',
          [etag, bucket, finalKey]
        );
      } catch (err) {
        logger.warn(
          'Failed to persist object etag; CDN cache-busting will fall back to uploaded_at',
          {
            bucket,
            key: finalKey,
            error: err instanceof Error ? err.message : String(err),
          }
        );
      }
    }

    return {
      bucket,
      key: finalKey,
      size: file.size,
      mimeType: file.mimetype,
      uploadedAt,
      url: this.buildObjectUrl(bucket, finalKey, etag || uploadedAt),
    };
  }

  async getObject(
    ctx: UserContext | undefined,
    bucket: string,
    key: string,
    hasApiKey: boolean = false
  ): Promise<StorageObjectResult | null> {
    this.validateBucketName(bucket);
    this.validateKey(key);

    const selectObjectMetadata = async (db: PoolClient) => {
      const result = await db.query(
        'SELECT * FROM storage.objects WHERE bucket = $1 AND key = $2',
        [bucket, key]
      );
      return result.rows[0] as StorageRecord | undefined;
    };

    let metadata: StorageRecord | undefined;
    if (hasApiKey || ctx?.role === 'project_admin' || (await this.isBucketPublic(bucket))) {
      metadata = await runWithRootAccess(this.getPool(), selectObjectMetadata);
    } else if (!ctx) {
      return null;
    } else {
      metadata = await withUserContext(this.getPool(), ctx, selectObjectMetadata);
    }

    if (!metadata) {
      return null;
    }

    const file = await this.provider.getObject(metadata.bucket, metadata.key);
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
        url: this.buildObjectUrl(
          metadata.bucket,
          metadata.key,
          metadata.etag || metadata.uploaded_at
        ),
      },
    };
  }

  async deleteObject(
    ctx: UserContext | undefined,
    bucket: string,
    key: string,
    hasApiKey: boolean = false
  ): Promise<boolean> {
    this.validateBucketName(bucket);
    this.validateKey(key);

    // DB DELETE first (RLS DELETE policy gates authorization) so a permissive
    // SELECT + restrictive DELETE policy combo can't be exploited to destroy
    // other users' blobs. If rowCount=0 the caller had no DELETE permission
    // (or the row was already gone) — return false without touching storage.
    // Provider delete then runs outside the tx; failure here leaves an orphan
    // blob that an external GC sweep can reclaim, but never an orphan row.
    const deleteObjectRow = async (db: PoolClient) => {
      const result = await db.query('DELETE FROM storage.objects WHERE bucket = $1 AND key = $2', [
        bucket,
        key,
      ]);
      return (result.rowCount ?? 0) > 0;
    };
    let deleted: boolean;
    if (hasApiKey || ctx?.role === 'project_admin') {
      deleted = await runWithRootAccess(this.getPool(), deleteObjectRow);
    } else {
      if (!ctx) {
        throw new AppError('Forbidden', 403, ERROR_CODES.STORAGE_PERMISSION_DENIED);
      }
      deleted = await withUserContext(this.getPool(), ctx, deleteObjectRow);
    }

    if (!deleted) {
      return false;
    }

    await this.provider.deleteObject(bucket, key);
    return true;
  }

  async listObjects(
    ctx: UserContext | undefined,
    bucket: string,
    prefix: string | undefined,
    limit: number = DEFAULT_LIST_LIMIT,
    offset: number = 0,
    searchQuery: string | undefined,
    hasApiKey: boolean = false
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

    // RLS scopes both queries for end-user JWT callers. Admin/API-key callers
    // use the backend pool because they can manage every object through the API.
    const listVisibleObjects = async (db: PoolClient) => {
      const objectsResult = await db.query(query, queryParams);
      const totalResult = await db.query(countQuery, params);

      return {
        objects: objectsResult.rows.map((obj) => ({
          ...obj,
          mimeType: obj.mime_type,
          uploadedAt: obj.uploaded_at,
          url: this.buildObjectUrl(bucket, obj.key, obj.etag || obj.uploaded_at),
        })),
        total: parseInt(totalResult.rows[0].count, 10),
      };
    };
    if (hasApiKey || ctx?.role === 'project_admin') {
      return runWithRootAccess(this.getPool(), listVisibleObjects);
    }
    if (!ctx) {
      throw new AppError('Forbidden', 403, ERROR_CODES.STORAGE_PERMISSION_DENIED);
    }
    return withUserContext(this.getPool(), ctx, listVisibleObjects);
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
      if (!(await this.bucketExists(bucket, client))) {
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
      if (await this.bucketExists(bucket, client)) {
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
      if (!(await this.bucketExists(bucket, client))) {
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
    ctx: UserContext | undefined,
    bucket: string,
    metadata: {
      filename: string;
      contentType?: string;
      size?: number;
    },
    hasApiKey: boolean = false
  ) {
    this.validateBucketName(bucket);

    if (!(await this.bucketExists(bucket))) {
      throw new Error(`Bucket "${bucket}" does not exist`);
    }

    const key = await this.generateNextAvailableKey(bucket, metadata.filename, this.getPool());
    const maxFileSizeBytes = await StorageConfigService.getInstance().getMaxFileSizeBytes();
    if (hasApiKey || ctx?.role === 'project_admin') {
      return this.provider.getUploadStrategy(bucket, key, metadata, maxFileSizeBytes);
    }
    if (!ctx) {
      throw new AppError('Forbidden', 403, ERROR_CODES.STORAGE_PERMISSION_DENIED);
    }
    const userId = ctx.id ?? null;
    await withUserContext(this.getPool(), ctx, async (client) => {
      await client.query('SAVEPOINT upload_strategy_rls_probe');
      try {
        await client.query(
          `INSERT INTO storage.objects (bucket, key, size, mime_type, uploaded_by, uploaded_via)
           VALUES ($1, $2, 0, $3, $4, 'rest')`,
          [bucket, key, metadata.contentType || null, userId]
        );
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT upload_strategy_rls_probe');
        await client.query('RELEASE SAVEPOINT upload_strategy_rls_probe');
      }
    });
    return this.provider.getUploadStrategy(bucket, key, metadata, maxFileSizeBytes);
  }

  async getDownloadStrategy(bucket: string, key: string) {
    this.validateBucketName(bucket);
    this.validateKey(key);

    // Check if bucket is public
    const isPublic = await this.isBucketPublic(bucket);

    // Auto-calculate expiry based on bucket visibility if not provided
    const expiresIn = isPublic ? PUBLIC_BUCKET_EXPIRY : PRIVATE_BUCKET_EXPIRY;

    // Fetch the version stamp (etag preferred, uploaded_at fallback) and pass
    // it to the provider, which knows whether its URL flavor tolerates an
    // extra `?v=` query param. CloudFront and local direct URLs do; raw S3
    // SigV4 presigned URLs do NOT (signature covers every query param), so
    // appending after signing would yield SignatureDoesNotMatch 403s. The DB
    // read uses the normal backend pool because the caller already gated
    // access through RLS, an API key, or a public bucket check.
    const versionRow = await this.getPool().query(
      'SELECT etag, uploaded_at FROM storage.objects WHERE bucket = $1 AND key = $2',
      [bucket, key]
    );
    const version = this.toVersionStamp(
      (versionRow.rows[0]?.etag as string | null) ??
        (versionRow.rows[0]?.uploaded_at as Date | null) ??
        null
    );

    return this.provider.getDownloadStrategy(bucket, key, expiresIn, isPublic, version || null);
  }

  /**
   * RLS-gated existence check. Returns true iff the caller is allowed by
   * `storage.objects` RLS policies to see this row. Public bucket rows are
   * visible by definition, but missing rows still return false.
   * Admin/API-key callers bypass RLS here because they can manage every object
   * through the storage API; end-user callers are scoped by storage.objects RLS.
   */
  async objectIsVisible(
    ctx: UserContext | undefined,
    bucket: string,
    key: string,
    hasApiKey: boolean = false
  ): Promise<boolean> {
    this.validateBucketName(bucket);
    this.validateKey(key);

    const checkVisibleObject = async (db: PoolClient) => {
      const result = await db.query(
        'SELECT 1 FROM storage.objects WHERE bucket = $1 AND key = $2',
        [bucket, key]
      );
      return (result.rowCount ?? 0) > 0;
    };

    if (hasApiKey || ctx?.role === 'project_admin' || (await this.isBucketPublic(bucket))) {
      return runWithRootAccess(this.getPool(), checkVisibleObject);
    }
    if (!ctx) {
      return false;
    }
    return withUserContext(this.getPool(), ctx, checkVisibleObject);
  }

  async confirmUpload(
    ctx: UserContext | undefined,
    bucket: string,
    key: string,
    metadata: {
      size: number;
      contentType?: string;
      etag?: string;
    },
    hasApiKey: boolean = false
  ): Promise<StorageFileSchema> {
    this.validateBucketName(bucket);
    this.validateKey(key);

    // Verify the file exists in storage and get its actual size + etag.
    // The server-side etag overrides whatever the client passed: browsers
    // don't expose the S3 `ETag` response header on cross-origin PUTs unless
    // the bucket CORS allowlists it, so client-supplied etag is unreliable.
    // Trusting the HEAD result guarantees the row has a real digest the
    // download URL can version on.
    const {
      exists,
      size: actualSize,
      etag: serverEtag,
    } = await this.provider.verifyObjectExists(bucket, key);
    if (!exists) {
      throw new Error(`Upload not found for key "${key}" in bucket "${bucket}"`);
    }
    const finalEtag = serverEtag || metadata.etag || null;

    // Defense-in-depth: reject if the actual size exceeds the configured limit
    const fileSize = actualSize ?? metadata.size;
    const maxBytes = await StorageConfigService.getInstance().getMaxFileSizeBytes();
    if (fileSize > maxBytes) {
      const limitMb = Math.round(maxBytes / (1024 * 1024));
      throw new Error(`File size exceeds the configured maximum upload size of ${limitMb} MB`);
    }

    // Already-confirmed check runs on the admin pool deliberately — the
    // friendly "already confirmed" error must fire even when the existing
    // row was uploaded by a different user (RLS would hide it). Falling
    // through to the INSERT in that case would either raise a unique
    // constraint violation (worse UX) or silently shadow the original
    // row depending on the schema.
    const existingResult = await this.getPool().query(
      'SELECT key FROM storage.objects WHERE bucket = $1 AND key = $2',
      [bucket, key]
    );

    if (existingResult.rows[0]) {
      throw new Error(`File "${key}" already confirmed in bucket "${bucket}"`);
    }

    // INSERT runs through withUserContext for end-user callers, so the RLS
    // WITH CHECK on storage_objects_owner_insert verifies uploaded_by =
    // jwt.sub. Admin/API-key callers use the backend pool.
    const userId = ctx?.id ?? null;
    const insertObjectRow = (db: PoolClient) =>
      db.query(
        `INSERT INTO storage.objects (bucket, key, size, mime_type, etag, uploaded_by, uploaded_via)
         VALUES ($1, $2, $3, $4, $5, $6, 'rest')
         RETURNING uploaded_at as "uploadedAt"`,
        [bucket, key, fileSize, metadata.contentType || null, finalEtag, userId]
      );
    let result: Awaited<ReturnType<typeof insertObjectRow>>;
    if (hasApiKey || ctx?.role === 'project_admin') {
      result = await runWithRootAccess(this.getPool(), insertObjectRow);
    } else {
      if (!ctx) {
        throw new AppError('Forbidden', 403, ERROR_CODES.STORAGE_PERMISSION_DENIED);
      }
      result = await withUserContext(this.getPool(), ctx, insertObjectRow);
    }

    if (!result.rows[0]) {
      throw new Error(`Failed to retrieve upload timestamp for ${bucket}/${key}`);
    }

    return {
      bucket,
      key,
      size: fileSize,
      mimeType: metadata.contentType,
      uploadedAt: result.rows[0].uploadedAt,
      url: this.buildObjectUrl(bucket, key, finalEtag || result.rows[0].uploadedAt),
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
   * the user API. API-key and S3-internal paths use the backend pool and see
   * them without end-user RLS.
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
    // ON CONFLICT preserves uploaded_by — clobbering to NULL would silently
    // strip ownership when S3 overwrites a REST-uploaded key.
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
         s3_access_key_id = EXCLUDED.s3_access_key_id`,
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

  async bucketExists(bucket: string, db: Pool | PoolClient = this.getPool()): Promise<boolean> {
    const r = await db.query('SELECT 1 FROM storage.buckets WHERE name = $1 LIMIT 1', [bucket]);
    return (r.rowCount ?? 0) > 0;
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

async function runWithRootAccess<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
