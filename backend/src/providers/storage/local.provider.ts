import fs from 'fs/promises';
import path from 'path';
import { UploadStrategyResponse, DownloadStrategyResponse } from '@insforge/shared-schemas';
import { StorageProvider } from './base.provider.js';
import { getApiBaseUrl } from '@/utils/environment.js';

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

  async copyObject(bucket: string, sourceKey: string, destKey: string): Promise<void> {
    const srcPath = this.getFilePath(bucket, sourceKey);
    const destPath = this.getFilePath(bucket, destKey);
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.copyFile(srcPath, destPath);
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
}
