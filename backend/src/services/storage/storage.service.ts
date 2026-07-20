import path from 'path';
import { Pool, PoolClient } from 'pg';
import { AppError } from '@/utils/errors.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import type { UserContext } from '@/api/middlewares/auth.js';
import { withUserContext } from '@/services/database/user-context.service.js';
import { StorageRecord } from '@/types/storage.js';
import {
  ERROR_CODES,
  DeleteObjectResult,
  DeleteObjectsResponse,
  StorageBucketSchema,
  StorageFileSchema,
  StorageMetadataSchema,
} from '@insforge/shared-schemas';
import { StorageProvider } from '@/providers/storage/base.provider.js';
import { LocalStorageProvider } from '@/providers/storage/local.provider.js';
import { S3StorageProvider } from '@/providers/storage/s3.provider.js';
import { StorageConfigService } from '@/services/storage/storage-config.service.js';
import logger from '@/utils/logger.js';
import { escapeSqlLikePattern } from '@/utils/validations.js';
import { getApiBaseUrl } from '@/utils/environment.js';
import { appConfig } from '@/infra/config/app.config.js';

const DEFAULT_LIST_LIMIT = 100;
const GIGABYTE_IN_BYTES = 1024 * 1024 * 1024;
const PUBLIC_BUCKET_EXPIRY = 0; // Public buckets don't expire
const PRIVATE_BUCKET_EXPIRY = 3600; // Private buckets expire in 1 hour
const MIN_SIGNED_URL_EXPIRY = 1; // 1 second
const MAX_SIGNED_URL_EXPIRY = 604800; // 7 days — S3 SigV4 presign ceiling

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
      throw new AppError(
        'Invalid bucket name. Use only letters, numbers, hyphens, and underscores.',
        400,
        ERROR_CODES.STORAGE_INVALID_PARAMETER
      );
    }
  }

  private validateKey(key: string): void {
    // Prevent directory traversal
    if (key.includes('..') || key.startsWith('/')) {
      throw new AppError(
        'Invalid key. Cannot use ".." or start with "/"',
        400,
        ERROR_CODES.STORAGE_INVALID_PARAMETER
      );
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

  async putObject(
    ctx: UserContext | undefined,
    bucket: string,
    originalKey: string,
    file: Express.Multer.File,
    hasApiKey: boolean = false
  ): Promise<StorageFileSchema> {
    this.validateBucketName(bucket);
    this.validateKey(originalKey);

    const finalKey = originalKey;
    const userId = ctx?.role === 'authenticated' ? ctx.id : null;
    // Set uploaded_at app-side instead of reading back the DB default via
    // RETURNING. This keeps response construction independent of an extra
    // row-returning permission check after the create-or-replace write.
    const uploadedAt = new Date();
    const writeObject = async (db: PoolClient) => {
      // PUT creates or replaces the object at the exact key. The conflict arm
      // deliberately leaves uploaded_by untouched so replacing content never
      // reassigns ownership. Under an end-user RLS context Postgres checks the
      // INSERT policy for the proposed row and, on conflict, the UPDATE policy
      // against both the existing and resulting rows. A denial raises 42501
      // before the provider blob is written below.
      await db.query(
        `
        INSERT INTO storage.objects (bucket, key, size, mime_type, uploaded_by, uploaded_via, uploaded_at)
        VALUES ($1, $2, $3, $4, $5, 'rest', $6)
        ON CONFLICT (bucket, key) DO UPDATE SET
          size         = EXCLUDED.size,
          mime_type    = EXCLUDED.mime_type,
          uploaded_via = EXCLUDED.uploaded_via,
          uploaded_at  = EXCLUDED.uploaded_at
      `,
        [bucket, finalKey, file.size, file.mimetype || null, userId, uploadedAt]
      );

      const { etag: providerEtag } = await this.provider.putObject(bucket, finalKey, file);
      return { etag: providerEtag, uploadedAt };
    };
    let uploadedObject: Awaited<ReturnType<typeof writeObject>>;
    try {
      if (hasApiKey || ctx?.role === 'project_admin') {
        uploadedObject = await runWithRootAccess(this.getPool(), writeObject);
      } else {
        if (!ctx) {
          throw new AppError('Forbidden', 403, ERROR_CODES.STORAGE_PERMISSION_DENIED);
        }
        uploadedObject = await withUserContext(this.getPool(), ctx, writeObject);
      }
    } catch (error) {
      throw this.mapObjectWriteError(error, bucket, finalKey);
    }
    const { etag } = uploadedObject;

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
      uploadedAt: uploadedAt.toISOString(),
      url: this.buildObjectUrl(bucket, finalKey, etag || uploadedAt),
    };
  }

  /**
   * Map low-level object-write failures to friendly AppErrors:
   * - 23505 (unique_violation): the write conflicts with another unique row.
   * - 42501 (insufficient_privilege): RLS rejected the create or replace.
   */
  private mapObjectWriteError(error: unknown, bucket: string, key: string): unknown {
    const code = (error as { code?: string })?.code;
    if (code === '23505') {
      return new AppError(
        `Object "${key}" conflicts with an existing record in bucket "${bucket}".`,
        409,
        ERROR_CODES.STORAGE_ALREADY_EXISTS
      );
    }
    if (code === '42501') {
      return new AppError(
        `You do not have permission to write "${key}" in bucket "${bucket}"`,
        403,
        ERROR_CODES.STORAGE_PERMISSION_DENIED
      );
    }
    return error;
  }

  async getObject(
    ctx: UserContext | undefined,
    bucket: string,
    key: string,
    hasApiKey: boolean = false,
    prefetchedMetadata?: StorageRecord | null
  ): Promise<StorageObjectResult | null> {
    this.validateBucketName(bucket);
    this.validateKey(key);

    let metadata = prefetchedMetadata;
    if (metadata && (metadata.bucket !== bucket || metadata.key !== key)) {
      metadata = null;
    }

    metadata = metadata ?? (await this.getObjectMetadataVisible(ctx, bucket, key, hasApiKey));
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
        key,
        bucket,
        size: metadata.size,
        mimeType: metadata.mime_type,
        uploadedAt: metadata.uploaded_at,
        url: this.buildObjectUrl(bucket, key, metadata.etag || metadata.uploaded_at),
      },
    };
  }

  async deleteObject(
    ctx: UserContext | undefined,
    bucket: string,
    key: string,
    hasApiKey: boolean = false
  ): Promise<boolean> {
    const result = await this.deleteObjects(ctx, bucket, [key], hasApiKey);
    return result.results.some((entry) => entry.key === key && entry.status !== 'notFound');
  }

  async deleteObjects(
    ctx: UserContext | undefined,
    bucket: string,
    keys: string[],
    hasApiKey: boolean = false
  ): Promise<DeleteObjectsResponse> {
    this.validateBucketName(bucket);
    const uniqueKeys = [...new Set(keys)];
    uniqueKeys.forEach((key) => this.validateKey(key));

    const deleteObjectRows = async (db: PoolClient): Promise<string[]> => {
      const result = await db.query<{ key: string }>(
        'DELETE FROM storage.objects WHERE bucket = $1 AND key = ANY($2::text[]) RETURNING key',
        [bucket, uniqueKeys]
      );
      return result.rows.map((row) => row.key);
    };

    let dbDeletedKeys: string[];
    if (hasApiKey || ctx?.role === 'project_admin') {
      dbDeletedKeys = await runWithRootAccess(this.getPool(), deleteObjectRows);
    } else {
      if (!ctx) {
        throw new AppError('Forbidden', 403, ERROR_CODES.STORAGE_PERMISSION_DENIED);
      }
      dbDeletedKeys = await withUserContext(this.getPool(), ctx, deleteObjectRows);
    }

    const dbDeletedKeySet = new Set(dbDeletedKeys);
    if (dbDeletedKeys.length === 0) {
      return {
        results: uniqueKeys.map((key) => ({ key, status: 'notFound' })),
      };
    }

    try {
      const providerResult = await this.provider.deleteObjects(bucket, dbDeletedKeys);
      const providerDeletedKeys = new Set(
        providerResult.deleted.filter((key) => dbDeletedKeySet.has(key))
      );
      const failedByKey = new Map(
        providerResult.failed
          .filter((failure) => dbDeletedKeySet.has(failure.key))
          .map((failure) => [failure.key, failure.message])
      );

      const results: DeleteObjectResult[] = uniqueKeys.map((key) => {
        if (!dbDeletedKeySet.has(key)) {
          return { key, status: 'notFound' };
        }
        const failureMessage = failedByKey.get(key);
        if (failureMessage) {
          return { key, status: 'failed', message: failureMessage };
        }
        if (providerDeletedKeys.has(key)) {
          return { key, status: 'deleted' };
        }
        return { key, status: 'failed', message: 'Failed to delete object' };
      });

      const failed = results
        .filter((result) => result.status === 'failed')
        .map((result) => ({
          key: result.key,
          message: result.message ?? 'Failed to delete object',
        }));

      if (failed.length > 0) {
        logger.warn('Storage provider batch delete partially failed after DB rows were deleted', {
          bucket,
          failed,
        });
      }
      return { results };
    } catch (error) {
      logger.error('Storage provider batch delete failed', {
        bucket,
        keys: dbDeletedKeys,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        results: uniqueKeys.map((key) =>
          dbDeletedKeySet.has(key)
            ? { key, status: 'failed', message: 'Failed to delete object' }
            : { key, status: 'notFound' }
        ),
      };
    }
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
    hasApiKey: boolean = false,
    contentType: string = 'application/octet-stream'
  ) {
    this.validateBucketName(bucket);

    if (!(await this.bucketExists(bucket))) {
      throw new Error(`Bucket "${bucket}" does not exist`);
    }

    // The filename is the exact object key; a later upload to that key
    // replaces the current object, matching S3 PUT semantics. Callers that
    // want a server-generated unique key use the POST /objects route.
    const key = metadata.filename;
    this.validateKey(key);

    const maxFileSizeBytes = await StorageConfigService.getInstance().getMaxFileSizeBytes();
    if (hasApiKey || ctx?.role === 'project_admin') {
      return this.provider.getUploadStrategy(bucket, key, metadata, maxFileSizeBytes, contentType);
    }
    if (!ctx) {
      throw new AppError('Forbidden', 403, ERROR_CODES.STORAGE_PERMISSION_DENIED);
    }
    const userId = ctx?.role === 'authenticated' ? ctx.id : null;
    // A presigned URL bypasses RLS at redeem time, so create-or-replace
    // permission must be proven before issuing one. The atomic conflict write
    // exercises INSERT policies and, for an existing key, UPDATE policies. It
    // is always rolled back to leave metadata unchanged until confirm-upload.
    await withUserContext(this.getPool(), ctx, async (client) => {
      await client.query('SAVEPOINT upload_strategy_rls_probe');
      try {
        await client.query(
          `INSERT INTO storage.objects (bucket, key, size, mime_type, uploaded_by, uploaded_via)
           VALUES ($1, $2, $3, $4, $5, 'rest')
           ON CONFLICT (bucket, key) DO UPDATE SET
             size         = EXCLUDED.size,
             mime_type    = EXCLUDED.mime_type,
             uploaded_via = EXCLUDED.uploaded_via`,
          [bucket, key, metadata.size ?? 0, metadata.contentType || null, userId]
        );
      } catch (error) {
        throw this.mapObjectWriteError(error, bucket, key);
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT upload_strategy_rls_probe');
        await client.query('RELEASE SAVEPOINT upload_strategy_rls_probe');
      }
    });
    return this.provider.getUploadStrategy(bucket, key, metadata, maxFileSizeBytes, contentType);
  }

  async getDownloadStrategy(
    bucket: string,
    key: string,
    requestedExpiresIn?: number,
    options?: { asAttachment?: boolean; prefetchedMetadata?: StorageRecord | null }
  ) {
    this.validateBucketName(bucket);
    this.validateKey(key);

    // Check if bucket is public
    const isPublic = await this.isBucketPublic(bucket);

    // Auto-calculate expiry based on bucket visibility if not provided.
    // Private buckets honor a caller-supplied TTL (clamped to a safe range) so
    // `createSignedUrl(key, expiresIn)` can mint short-lived links; public
    // buckets keep their long, server-decided expiry regardless (the provider
    // also forces 7 days for public objects).
    let expiresIn = isPublic ? PUBLIC_BUCKET_EXPIRY : PRIVATE_BUCKET_EXPIRY;
    if (!isPublic && requestedExpiresIn !== undefined && Number.isFinite(requestedExpiresIn)) {
      expiresIn = Math.min(
        Math.max(Math.floor(requestedExpiresIn), MIN_SIGNED_URL_EXPIRY),
        MAX_SIGNED_URL_EXPIRY
      );
    }

    // Fetch the version stamp (etag preferred, uploaded_at fallback) and pass
    // it to the provider, which knows whether its URL flavor tolerates an
    // extra `?v=` query param. CloudFront and local direct URLs do; raw S3
    // SigV4 presigned URLs do NOT (signature covers every query param), so
    // appending after signing would yield SignatureDoesNotMatch 403s. The DB
    // read uses the normal backend pool because the caller already gated
    // access through RLS, an API key, or a public bucket check.
    let etag = options?.prefetchedMetadata?.etag;
    let uploadedAt = options?.prefetchedMetadata?.uploaded_at;

    if (!etag && !uploadedAt) {
      const versionRow = await this.getPool().query(
        'SELECT etag, uploaded_at as "uploadedAt" FROM storage.objects WHERE bucket = $1 AND key = $2 LIMIT 1',
        [bucket, key]
      );
      etag = versionRow.rows[0]?.etag;
      uploadedAt = versionRow.rows[0]?.uploadedAt;
    }
    const version = this.toVersionStamp((etag as string | null) ?? uploadedAt ?? null);

    return this.provider.getDownloadStrategy(bucket, key, expiresIn, isPublic, version || null, {
      asAttachment: options?.asAttachment,
    });
  }

  /**
   * RLS-gated existence check. Returns the StorageRecord iff the caller is allowed by
   * `storage.objects` RLS policies to see this row. Public bucket rows are
   * visible by definition, but missing rows still return null.
   * Admin/API-key callers bypass RLS here because they can manage every object
   * through the storage API; end-user callers are scoped by storage.objects RLS.
   */
  async getObjectMetadataVisible(
    ctx: UserContext | undefined,
    bucket: string,
    key: string,
    hasApiKey: boolean = false
  ): Promise<StorageRecord | null> {
    this.validateBucketName(bucket);
    this.validateKey(key);

    const checkVisibleObject = async (db: PoolClient) => {
      const result = await db.query(
        'SELECT * FROM storage.objects WHERE bucket = $1 AND key = $2',
        [bucket, key]
      );
      return result.rows[0] || null;
    };

    if (hasApiKey || ctx?.role === 'project_admin' || (await this.isBucketPublic(bucket))) {
      return runWithRootAccess(this.getPool(), checkVisibleObject);
    }
    if (!ctx) {
      return null;
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

    // Writes run through withUserContext for end-user callers, so the RLS
    // policies on storage.objects gate them (INSERT WITH CHECK for new keys,
    // UPDATE USING/WITH CHECK for replaces). Admin/API-key callers use the
    // backend pool.
    const userId = ctx?.role === 'authenticated' ? ctx.id : null;
    // Set uploaded_at app-side instead of reading it back via RETURNING. This
    // avoids an additional row-returning permission check after confirmation.
    const uploadedAt = new Date();
    const writeObjectRow = async (db: PoolClient) => {
      // Confirm mirrors PUT: create the metadata row or update it in place.
      // uploaded_by is intentionally preserved on conflict.
      await db.query(
        `INSERT INTO storage.objects (bucket, key, size, mime_type, etag, uploaded_by, uploaded_via, uploaded_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'rest', $7)
         ON CONFLICT (bucket, key) DO UPDATE SET
           size         = EXCLUDED.size,
           mime_type    = EXCLUDED.mime_type,
           etag         = EXCLUDED.etag,
           uploaded_via = EXCLUDED.uploaded_via,
           uploaded_at  = EXCLUDED.uploaded_at`,
        [bucket, key, fileSize, metadata.contentType || null, finalEtag, userId, uploadedAt]
      );
    };
    try {
      if (hasApiKey || ctx?.role === 'project_admin') {
        await runWithRootAccess(this.getPool(), writeObjectRow);
      } else {
        if (!ctx) {
          throw new AppError('Forbidden', 403, ERROR_CODES.STORAGE_PERMISSION_DENIED);
        }
        await withUserContext(this.getPool(), ctx, writeObjectRow);
      }
    } catch (error) {
      throw this.mapObjectWriteError(error, bucket, key);
    }

    return {
      bucket,
      key,
      size: fileSize,
      mimeType: metadata.contentType,
      uploadedAt: uploadedAt.toISOString(),
      url: this.buildObjectUrl(bucket, key, finalEtag || uploadedAt),
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

  // ==========================================================================
  // S3 CORS support
  // ==========================================================================

  async getBucketCorsRules(bucket: string): Promise<Array<Record<string, unknown>> | null> {
    const r = await this.getPool().query('SELECT cors_rules FROM storage.buckets WHERE name = $1', [
      bucket,
    ]);
    if (r.rowCount === 0) {
      return null;
    }
    return r.rows[0].cors_rules as Array<Record<string, unknown>> | null;
  }

  async putBucketCorsRules(bucket: string, rules: Array<Record<string, unknown>>): Promise<void> {
    await this.getPool().query(
      `UPDATE storage.buckets SET cors_rules = $1, updated_at = NOW()
       WHERE name = $2`,
      [JSON.stringify(rules), bucket]
    );
  }

  async deleteBucketCorsRules(bucket: string): Promise<void> {
    await this.getPool().query(
      `UPDATE storage.buckets SET cors_rules = NULL, updated_at = NOW()
       WHERE name = $1`,
      [bucket]
    );
  }

  // ==========================================================================
  // S3 object tagging support
  // ==========================================================================

  async getObjectTags(
    bucket: string,
    key: string
  ): Promise<Array<{ tagKey: string; tagValue: string }>> {
    const r = await this.getPool().query(
      'SELECT tag_key, tag_value FROM storage.object_tags WHERE bucket = $1 AND key = $2 ORDER BY tag_key',
      [bucket, key]
    );
    return r.rows.map((row) => ({ tagKey: row.tag_key, tagValue: row.tag_value }));
  }

  async putObjectTags(
    bucket: string,
    key: string,
    tags: Array<{ tagKey: string; tagValue: string }>
  ): Promise<void> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM storage.object_tags WHERE bucket = $1 AND key = $2', [
        bucket,
        key,
      ]);
      for (const t of tags) {
        await client.query(
          'INSERT INTO storage.object_tags (bucket, key, tag_key, tag_value) VALUES ($1, $2, $3, $4)',
          [bucket, key, t.tagKey, t.tagValue]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteObjectTags(bucket: string, key: string): Promise<void> {
    await this.getPool().query('DELETE FROM storage.object_tags WHERE bucket = $1 AND key = $2', [
      bucket,
      key,
    ]);
  }

  // ==========================================================================
  // S3 bucket versioning support
  // ==========================================================================

  async getBucketVersioningStatus(bucket: string): Promise<string | null> {
    const r = await this.getPool().query(
      'SELECT versioning_status FROM storage.buckets WHERE name = $1',
      [bucket]
    );
    if (r.rowCount === 0) {
      return null;
    }
    return r.rows[0].versioning_status as string;
  }

  async putBucketVersioningStatus(bucket: string, status: string): Promise<void> {
    await this.getPool().query(
      `UPDATE storage.buckets SET versioning_status = $1, updated_at = NOW()
       WHERE name = $2`,
      [status, bucket]
    );
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
