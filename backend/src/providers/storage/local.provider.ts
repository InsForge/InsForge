import fs from 'fs/promises';
import path from 'path';
import { UploadStrategyResponse, DownloadStrategyResponse } from '@insforge/shared-schemas';
import { StorageProvider } from './base.provider.js';
import { getApiBaseUrl } from '@/utils/environment';

/**
 * Local filesystem storage implementation
 */
export class LocalStorageProvider implements StorageProvider {
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
