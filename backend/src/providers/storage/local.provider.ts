import fs from 'fs/promises';
import path from 'path';
import { UploadStrategyResponse, DownloadStrategyResponse } from '@insforge/shared-schemas';
import { StorageProvider, ObjectMetadata, GetObjectResult } from './base.provider.js';
import { getApiBaseUrl } from '@/utils/environment.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';

/**
 * Local filesystem storage implementation
 */
export class LocalStorageProvider implements StorageProvider {
  constructor(private baseDir: string) {}

  async initialize(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  private getValidatedPath(bucket: string, ...parts: string[]): string {
    if (!bucket || bucket.trim() === '') {
      throw new Error('Invalid bucket name');
    }

    if (!/^[a-zA-Z0-9-_]+$/.test(bucket)) {
      throw new Error('Bucket name contains invalid characters');
    }

    const resolvedBaseDir = path.resolve(this.baseDir);
    const resolvedPath = path.resolve(this.baseDir, bucket, ...parts);
    const relativePath = path.relative(resolvedBaseDir, resolvedPath);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new Error('Access denied: Path is outside the base directory');
    }

    return resolvedPath;
  }

  private getFilePath(bucket: string, key: string): string {
    return this.getValidatedPath(bucket, key);
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
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    try {
      const filePath = this.getFilePath(bucket, key);
      await fs.unlink(filePath);
    } catch (error) {
      // Re-throw if it's not a "file not found" error (e.g., validation or permission error)
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async createBucket(bucket: string): Promise<void> {
    const bucketPath = this.getValidatedPath(bucket);
    await fs.mkdir(bucketPath, { recursive: true });
  }

  async deleteBucket(bucket: string): Promise<void> {
    try {
      const bucketPath = this.getValidatedPath(bucket);
      await fs.rm(bucketPath, { recursive: true, force: true });
    } catch (error) {
      // Re-throw if it's not a "not found" error
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  // Local storage doesn't support presigned URLs
  supportsPresignedUrls(): boolean {
    return false;
  }

  getUploadStrategy(
    bucket: string,
    key: string,
    _metadata: { contentType?: string; size?: number },
    _maxFileSizeBytes: number
  ): Promise<UploadStrategyResponse> {
    // For local storage, return direct upload strategy with absolute URL
    const baseUrl = getApiBaseUrl();
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
    const baseUrl = getApiBaseUrl();
    return Promise.resolve({
      method: 'direct',
      url: `${baseUrl}/api/storage/buckets/${bucket}/objects/${encodeURIComponent(key)}`,
    });
  }

  async verifyObjectExists(
    bucket: string,
    key: string
  ): Promise<{ exists: boolean; size?: number }> {
    // For local storage, check if file exists on disk and get its size
    try {
      const filePath = this.getFilePath(bucket, key);
      const stat = await fs.stat(filePath);
      return { exists: true, size: stat.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { exists: false };
      }
      throw error;
    }
  }

  // ==========================================================================
  // S3 Protocol extensions — not supported on the local filesystem backend.
  // Callers should check StorageService.isS3Provider() before invoking these.
  // ==========================================================================

  private notImplemented(op: string): never {
    throw new AppError(
      `S3 protocol operation '${op}' requires an S3 storage backend. ` +
        `Set AWS_S3_BUCKET (and optionally S3_ENDPOINT_URL for MinIO).`,
      501,
      ERROR_CODES.S3_PROTOCOL_UNAVAILABLE
    );
  }

  // These stubs throw synchronously; declaring them as non-async Promise
  // returns keeps the interface shape without tripping require-await, and the
  // thrown AppError surfaces to the caller the same way as any async reject.
  putObjectStream(): Promise<{ etag: string; size: number }> {
    this.notImplemented('PutObject/streaming');
  }
  headObject(): Promise<ObjectMetadata | null> {
    this.notImplemented('HeadObject');
  }
  copyObject(): Promise<{ etag: string; lastModified: Date }> {
    this.notImplemented('CopyObject');
  }
  getObjectStream(): Promise<GetObjectResult> {
    this.notImplemented('GetObject/streaming');
  }
  createMultipartUpload(): Promise<{ uploadId: string }> {
    this.notImplemented('CreateMultipartUpload');
  }
  uploadPart(): Promise<{ etag: string }> {
    this.notImplemented('UploadPart');
  }
  completeMultipartUpload(): Promise<{ etag: string; size: number }> {
    this.notImplemented('CompleteMultipartUpload');
  }
  abortMultipartUpload(): Promise<void> {
    this.notImplemented('AbortMultipartUpload');
  }
  listParts(): Promise<{
    parts: Array<{ partNumber: number; etag: string; size: number; lastModified: Date }>;
    isTruncated: boolean;
    nextPartNumberMarker?: number;
  }> {
    this.notImplemented('ListParts');
  }
}
