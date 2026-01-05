import { UploadStrategyResponse, DownloadStrategyResponse } from '@insforge/shared-schemas';

/**
 * Storage provider interface
 * Defines the contract that all storage providers must implement
 */
export interface StorageProvider {
  initialize(): void | Promise<void>;
  putObject(bucket: string, key: string, file: Express.Multer.File): Promise<void>;
  getObject(bucket: string, key: string): Promise<Buffer | null>;
  deleteObject(bucket: string, key: string): Promise<void>;
  createBucket(bucket: string): Promise<void>;
  deleteBucket(bucket: string): Promise<void>;

  // Presigned URL support
  supportsPresignedUrls(): boolean;
  getUploadStrategy(
    bucket: string,
    key: string,
    metadata: { contentType?: string; size?: number; maxFileSize?: number }
  ): Promise<UploadStrategyResponse>;
  getDownloadStrategy(
    bucket: string,
    key: string,
    expiresIn?: number,
    isPublic?: boolean
  ): Promise<DownloadStrategyResponse>;
  verifyObjectExists(bucket: string, key: string): Promise<boolean>;
}
